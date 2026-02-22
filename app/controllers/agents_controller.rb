class AgentsController < ApplicationController
  before_action :set_agent, only: [:update, :destroy, :regenerate_token, :prompt]

  def create
    @agent = current_user.agents.new(agent_params)

    if @agent.save
      redirect_to settings_path, notice: "Agent \"#{@agent.name}\" created."
    else
      redirect_to settings_path, alert: @agent.errors.full_messages.join(", ")
    end
  end

  def update
    if @agent.update(agent_params)
      redirect_to settings_path, notice: "Agent \"#{@agent.name}\" updated."
    else
      redirect_to settings_path, alert: @agent.errors.full_messages.join(", ")
    end
  end

  def destroy
    name = @agent.name
    @agent.destroy
    redirect_to settings_path, notice: "Agent \"#{name}\" removed."
  end

  def regenerate_token
    ApiToken.where(agent_id: @agent.id).delete_all
    @agent.reload
    @agent.create_api_token!(user: current_user, name: "#{@agent.name} Agent Token")
    redirect_to settings_path, notice: "Token regenerated for \"#{@agent.name}\"."
  end

  def prompt
    @agent = current_user.agents.includes(:api_token).find(params[:id])
    render layout: false
  end

  private

  def set_agent
    @agent = current_user.agents.find(params[:id])
  end

  def agent_params
    params.require(:agent).permit(:name, :emoji, :auto_mode)
  end
end
