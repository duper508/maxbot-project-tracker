module Api
  module TokenAuthentication
    extend ActiveSupport::Concern

    included do
      before_action :authenticate_api_token
      attr_reader :current_user, :current_agent
    end

    private

    def authenticate_api_token
      token = extract_token_from_header
      api_token = ApiToken.authenticate_token(token)

      unless api_token
        render json: { error: "Unauthorized" }, status: :unauthorized
        return
      end

      @current_user = api_token.user
      @current_agent = api_token.agent

      if @current_agent
        update_agent_info
      else
        # Legacy token without agent - try to find/create agent from headers
        legacy_agent_fallback(api_token)
      end
    end

    def extract_token_from_header
      auth_header = request.headers["Authorization"]
      return nil unless auth_header

      # Expected format: "Bearer <token>"
      match = auth_header.match(/\ABearer\s+(.+)\z/i)
      match&.[](1)
    end

    def update_agent_info
      updates = { last_active_at: Time.current }
      agent_name = request.headers["X-Agent-Name"]
      agent_emoji = request.headers["X-Agent-Emoji"]
      updates[:name] = agent_name if agent_name.present? && agent_name != @current_agent.name
      updates[:emoji] = agent_emoji if agent_emoji.present? && agent_emoji != @current_agent.emoji
      @current_agent.update_columns(updates)
    end

    def legacy_agent_fallback(api_token)
      agent_name = request.headers["X-Agent-Name"].presence || "OpenClaw"

      # Find or create agent for this legacy token
      @current_agent = @current_user.agents.find_by(name: agent_name)
      unless @current_agent
        @current_agent = @current_user.agents.create!(
          name: agent_name,
          emoji: request.headers["X-Agent-Emoji"].presence || "🦞"
        )
      end

      # Link the token to the agent
      api_token.update_columns(agent_id: @current_agent.id)
      @current_agent.update_columns(last_active_at: Time.current)

      # Also update user columns for backward compat
      user_updates = { agent_last_active_at: Time.current }
      user_updates[:agent_name] = agent_name if agent_name.present?
      agent_emoji = request.headers["X-Agent-Emoji"]
      user_updates[:agent_emoji] = agent_emoji if agent_emoji.present?
      current_user.update_columns(user_updates)
    end
  end
end
