class Agent < ApplicationRecord
  belongs_to :user
  has_one :api_token, dependent: :destroy
  has_many :tasks
  has_many :task_activities

  validates :name, presence: true
  validates :name, uniqueness: { scope: :user_id, message: "already exists" }

  after_create :generate_api_token

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
end
