module Api
  module V1
    class SettingsController < BaseController
      # GET /api/v1/settings - get current agent's settings
      def show
        render json: settings_json
      end

      # PATCH /api/v1/settings - update agent settings
      def update
        if current_agent&.update(settings_params)
          render json: settings_json
        else
          errors = current_agent&.errors&.full_messages&.join(", ") || "No agent found"
          render json: { error: errors }, status: :unprocessable_entity
        end
      end

      private

      def settings_params
        params.permit(:name, :emoji, :auto_mode)
      end

      def settings_json
        if current_agent
          {
            agent_name: current_agent.name,
            agent_emoji: current_agent.emoji,
            agent_auto_mode: current_agent.auto_mode,
            agent_status: current_agent.status,
            agent_id: current_agent.id,
            email: current_user.email_address
          }
        else
          {
            agent_name: current_user.agent_name || "OpenClaw",
            agent_emoji: current_user.agent_emoji || "🦞",
            agent_auto_mode: current_user.agent_auto_mode,
            agent_status: "not_connected",
            email: current_user.email_address
          }
        end
      end
    end
  end
end
