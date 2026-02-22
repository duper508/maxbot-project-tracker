import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["content", "button"]

  toggle() {
    const content = this.contentTarget
    const isHidden = content.classList.contains("hidden")
    content.classList.toggle("hidden")

    if (this.hasButtonTarget) {
      this.buttonTarget.textContent = isHidden ? "Hide Prompt" : "Show Prompt"
    }
  }
}
