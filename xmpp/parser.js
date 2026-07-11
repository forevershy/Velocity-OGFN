// Minimal XMPP stanza parser. Fortnite's stanzas are predictable enough that
// we only need the root element name, its attributes, and inner text.
function parseStanza(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();

  // Match the opening tag: <name attr="v" ...> or self-closing <name ... />
  const openTag = trimmed.match(/^<([a-zA-Z0-9:_-]+)((?:\s+[^>]*?)?)\s*\/?>/);
  if (!openTag) return null;

  const name = openTag[1];
  const attrString = openTag[2] || "";

  const attrs = {};
  const attrRegex = /([a-zA-Z0-9:_-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = attrRegex.exec(attrString)) !== null) {
    attrs[m[1]] = m[2];
  }

  // Inner text (for <auth> SASL payloads and simple <body> content).
  let text = "";
  const inner = trimmed.match(new RegExp(`^<${name}[^>]*>([\\s\\S]*)<\\/${name}>$`));
  if (inner) text = inner[1].trim();

  return { name, attrs, text, raw: trimmed };
}

module.exports = { parseStanza };
