class ApiToken < ApplicationRecord
  belongs_to :user
  belongs_to :agent, optional: true

  validates :token, presence: true, uniqueness: true
  validates :name, presence: true

  before_validation :generate_token, on: :create

  # Returns the User for backward compatibility
  def self.authenticate(token)
    api_token = authenticate_token(token)
    api_token&.user
  end

  # Returns the ApiToken record (used by token authentication concern)
  def self.authenticate_token(token)
    return nil if token.blank?

    api_token = find_by(token: token)
    return nil unless api_token

    api_token.touch(:last_used_at)
    api_token
  end

  private

  def generate_token
    self.token ||= SecureRandom.hex(32)
  end
end
