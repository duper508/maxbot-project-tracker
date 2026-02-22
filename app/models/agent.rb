class Agent < ApplicationRecord
  belongs_to :user
  has_one :api_token, dependent: :destroy
  has_many :tasks, dependent: :nullify
  has_many :task_activities, dependent: :nullify

  validates :name, presence: true
  validates :name, uniqueness: { scope: :user_id, message: "already exists" }

  after_create :generate_api_token
  before_destroy :unassign_tasks

  def status
    return "not_connected" unless api_token&.last_used_at.present?

    working = tasks.where(status: :in_progress).where.not(agent_claimed_at: nil).exists?
    if working
      "working"
    elsif last_active_at.present? && last_active_at > 5.minutes.ago
      "active"
    else
      "idle"
    end
  end

  private

  def generate_api_token
    create_api_token!(user: user, name: "#{name} Agent Token")
  end

  def unassign_tasks
    tasks.where(assigned_to_agent: true).update_all(
      assigned_to_agent: false, assigned_at: nil, agent_claimed_at: nil
    )
  end
end
