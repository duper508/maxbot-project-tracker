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

    # Link existing api_tokens to the user's new agent
    execute <<~SQL
      UPDATE api_tokens
      SET agent_id = agents.id
      FROM agents
      WHERE api_tokens.user_id = agents.user_id
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
