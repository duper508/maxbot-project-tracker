module ApplicationHelper
  def activity_icon_bg(activity)
    case activity.action
    when "created"
      "bg-status-info/20"
    when "moved"
      "bg-purple-900/30"
    when "updated"
      "bg-status-warning/20"
    else
      "bg-bg-elevated"
    end
  end

  def activity_icon(activity)
    case activity.action
    when "created"
      '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3 h-3 text-status-info"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>'.html_safe
    when "moved"
      '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3 h-3 text-purple-400"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>'.html_safe
    when "updated"
      '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3 h-3 text-status-warning"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" /></svg>'.html_safe
    else
      '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3 h-3 text-content-secondary"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>'.html_safe
    end
  end

  def agent_icon(agent, size_class: "w-5 h-5")
    return raw "<span>❓</span>" unless agent&.emoji
    
    # Map emoji to SVG file using Agent model's VALID_EMOJI mapping
    icon_map = Agent::VALID_EMOJI
    icon_file = icon_map[agent.emoji]
    
    if icon_file
      image_tag "agents/#{icon_file}", class: size_class, alt: agent.name
    else
      # Fallback to rendering the emoji string directly
      content_tag(:span, agent.emoji || "❓", class: "#{size_class} flex items-center justify-center text-lg leading-none")
    end
  end

  # Returns the list of available agent icons for UI pickers
  def agent_icon_options
    [
      { key: "gemini", icon: "gemini.svg", label: "Gemini" },
      { key: "codex", icon: "codex.svg", label: "Codex" },
      { key: "claude", icon: "claude.svg", label: "Claude" },
      { key: "lobster", icon: "lobster.svg", label: "Lobster" },
      { key: "robot", icon: "robot.svg", label: "Robot" }
    ]
  end
end
