class ProfilesController < ApplicationController
  def show
    @user = current_user
    @agents = current_user.agents.includes(:api_token).order(:created_at)
  end

  def update
    @user = current_user

    if params[:user][:remove_avatar] == "1"
      @user.avatar.purge if @user.avatar.attached?
      @user.avatar_url = nil
    end

    if @user.update(profile_params)
      redirect_to settings_path, notice: "Profile updated successfully."
    else
      @agents = current_user.agents.includes(:api_token).order(:created_at)
      render :show, status: :unprocessable_entity
    end
  end

  private

  def profile_params
    params.expect(user: [ :email_address, :avatar ])
  end
end
