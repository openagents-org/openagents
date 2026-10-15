/** Older image-only posts used the attachment storage names as their body. */
export function humanMessageContent(content: string, attachments: { filename: string }[]): string {
  if (attachments.length && content.trim() === attachments.map(file => file.filename).join(', ')) return '';
  return content;
}
