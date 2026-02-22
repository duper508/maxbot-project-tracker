class CreateAgents < ActiveRecord::Migration[8.1]
  def change
    create_table :agents do |t|
      t.references :user, null: false, foreign_key: true
      t.string :name, null: false
      t.string :emoji, default: "🦞"
      t.boolean :auto_mode, default: true, null: false
      t.datetime :last_active_at

      t.timestamps
    end

    add_index :agents, [:user_id, :name], unique: true

    add_reference :api_tokens, :agent, null: true, foreign_key: true
    add_reference :tasks, :agent, null: true, foreign_key: true
    add_reference :task_activities, :agent, null: true, foreign_key: true
  end
end
