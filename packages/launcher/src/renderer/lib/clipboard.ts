export async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {}
  }

  const textArea = document.createElement("textarea")
  textArea.value = text
  textArea.setAttribute("readonly", "")
  textArea.style.position = "fixed"
  textArea.style.left = "-9999px"
  document.body.appendChild(textArea)

  try {
    textArea.select()
    textArea.setSelectionRange(0, text.length)
    if (!document.execCommand("copy")) {
      throw new Error("Failed to copy text to clipboard")
    }
  } finally {
    textArea.remove()
  }
}
