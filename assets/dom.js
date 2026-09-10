/* Små DOM-hjälpare som både startsidan och hanteringssidan använder. */

export const $ = (selector, root = document) => root.querySelector(selector);

/**
 * Bygger ett element. `text` sätts som textContent, aldrig som HTML, så att
 * innehåll från tools.json inte kan tolkas som markup.
 * `html` finns för de fasta ikonerna i koden och ska inte ta emot data.
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child || child === 0) node.append(child);
  return node;
}

/** Gemener utan diakritiska tecken, så att "jamfor" hittar "jämför". */
export const fold = (value) =>
  String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** URL-vänlig identifierare. Behåller å/ä/ö som a/a/o i stället för att tappa dem. */
export function slugify(value) {
  const base = fold(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base || 'verktyg';
}
