export function generateShortTicket(length = 6): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')  // Remove non-word chars (except spaces and dashes)
    .replace(/[\s_-]+/g, '-')  // Replace spaces, underscores, and dashes with a single dash
    .replace(/^-+|-+$/g, '');  // Remove leading/trailing dashes
}
