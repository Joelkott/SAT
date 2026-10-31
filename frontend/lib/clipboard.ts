// Copy plain text to the clipboard.
// The church LAN serves plain HTTP, where navigator.clipboard is undefined,
// so fall back to execCommand on an off-screen textarea.
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.left = '-9999px';
  document.body.appendChild(el);
  el.select();
  try {
    if (!document.execCommand('copy')) throw new Error('execCommand copy failed');
  } finally {
    document.body.removeChild(el);
  }
}
