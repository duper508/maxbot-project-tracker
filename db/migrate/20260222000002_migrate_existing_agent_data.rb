class MigrateExistingAgentData < ActiveRecord::Migration[8.1]
  def up
    # Create an Agent record for each user that has agent data
    execute <<~SQL
      INSERT INTO agents (user_id, name, emoji, auto_mode, last_active_at, created_at, updated_at)
      SELECT id,
             COALESCE(agent_name, 'OpenClaw'),
             COALESCE(agent_emoji, '🦞'),
             agent_auto_mode,
             agent_last_active_at,
             NOW(),
             NOW()
      FROM users
      WHERE agent_name IS NOT NULL OR agent_last_active_at IS NOT NULL
    SQL

    # Link only the most recently used api_token per user to the agent.
    # Delete any older tokens to avoid leaving stale credentials active.
    execute <<~SQL
      UPDATE api_tokens
      SET agent_id = agents.id
      FROM agents
      WHERE api_tokens.user_id = agents.user_id
        AND api_tokens.id = (
          SELECT id FROM api_tokens t2
          WHERE t2.user_id = agents.user_id
          ORDER BY t2.last_used_at DESC NULLS LAST, t2.created_at DESC
          LIMIT 1
        )
    SQL

    execute <<~SQL
      DELETE FROM api_tokens
      WHERE agent_id IS NULL
        AND user_id IN (SELECT user_id FROM agents)
    SQL

    # Link tasks where assigned_to_agent = true to the agent
    execute <<~SQL
      UPDATE tasks
      SET agent_id = agents.id
      FROM agents
      WHERE tasks.user_id = agents.user_id
        AND tasks.assigned_to_agent = true
    SQL

    # Link task_activities where actor_type = 'agent' to the agent
    execute <<~SQL
      UPDATE task_activities
      SET agent_id = agents.id
      FROM agents
      WHERE task_activities.user_id = agents.user_id
        AND task_activities.actor_type = 'agent'
    SQL
  end

  def down
    # Clear agent references
    execute "UPDATE api_tokens SET agent_id = NULL"
    execute "UPDATE tasks SET agent_id = NULL"
    execute "UPDATE task_activities SET agent_id = NULL"

    # Remove migrated agent records
    execute "DELETE FROM agents"
  end
end
