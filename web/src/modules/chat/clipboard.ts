// Putting text on the clipboard (M1 #12). `navigator.clipboard` works in a secure page on a tap or click, which is every way a message is copied;
// where it is missing or refuses (an older iOS Safari, a page not served over HTTPS), a hidden text field and `execCommand('copy')` do the same
// from inside the tap. Resolves whether the text was copied, so that the screen says so only when it was.
// Text that is still being made (a whole transcript that is being read from Hermes) is handed over as a promise: the browser holds the tap's permission
// for it while it comes, which a `writeText` made after the wait would not have.
export async function copyText(wanted: string | Promise<string>): Promise<boolean> {
  if (typeof wanted !== 'string' && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': wanted.then((value) => new Blob([value], { type: 'text/plain' })) })]);
      return true;
    } catch {
      // Fall through: the browser refused it (or the text could not be made).
    }
  }
  const text = await wanted;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall through: the clipboard API is not there, or the browser refused it.
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.setAttribute('aria-hidden', 'true');
  field.style.position = 'fixed';
  field.style.insetBlockStart = '0';
  field.style.insetInlineStart = '0';
  field.style.opacity = '0';
  document.body.append(field);
  const selection = getSelection();
  const kept = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined;
  field.focus({ preventScroll: true });
  field.select();
  // iOS Safari only copies a field whose range is set explicitly.
  field.setSelectionRange(0, text.length);
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
    if (kept) {
      selection?.removeAllRanges();
      selection?.addRange(kept);
    }
  }
}
