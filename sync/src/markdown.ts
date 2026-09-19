// Minimal markdown-to-Notion-blocks conversion. Supports headings, fenced code, bulleted and
// numbered lists, and paragraphs -- enough to mirror a repository README/proposal/decision body
// without pulling in a full markdown parser. Anything unrecognized becomes a paragraph verbatim.
const MAX_BLOCKS = 300;
const MAX_RICH_TEXT_CHARS = 2000;

function chunk(text: string): {type:"text";text:{content:string}}[] {
  const parts: {type:"text";text:{content:string}}[] = [];
  for (let i = 0; i < text.length; i += MAX_RICH_TEXT_CHARS) parts.push({type:"text",text:{content:text.slice(i,i+MAX_RICH_TEXT_CHARS)}});
  return parts.length ? parts : [{type:"text",text:{content:""}}];
}
function paragraph(text: string) { return {object:"block",type:"paragraph",paragraph:{rich_text:chunk(text)}}; }
function heading(level: 1|2|3, text: string) {
  const key = `heading_${level}` as const;
  return {object:"block",type:key,[key]:{rich_text:chunk(text)}};
}
function listItem(kind:"bulleted_list_item"|"numbered_list_item", text: string) {
  return {object:"block",type:kind,[kind]:{rich_text:chunk(text)}};
}
function code(text: string, language: string) {
  return {object:"block",type:"code",code:{rich_text:chunk(text),language: language || "plain text"}};
}

export function markdownToBlocks(markdown: string): {blocks: unknown[]; truncated: boolean} {
  const lines = markdown.replace(/\r\n/g,"\n").split("\n");
  const blocks: unknown[] = [];
  let paragraphBuffer: string[] = [];
  const flush = () => { if (paragraphBuffer.length) { blocks.push(paragraph(paragraphBuffer.join(" "))); paragraphBuffer = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading3 = line.match(/^###\s+(.*)/);
    const heading2 = line.match(/^##\s+(.*)/);
    const heading1 = line.match(/^#\s+(.*)/);
    const fence = line.match(/^```\s*(\S*)\s*$/);
    const bullet = line.match(/^[-*]\s+(.*)/);
    const numbered = line.match(/^\d+\.\s+(.*)/);
    if (fence) {
      flush();
      const language = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { body.push(lines[i]); i++; }
      blocks.push(code(body.join("\n"), language));
    } else if (heading3) { flush(); blocks.push(heading(3, heading3[1])); }
    else if (heading2) { flush(); blocks.push(heading(2, heading2[1])); }
    else if (heading1) { flush(); blocks.push(heading(1, heading1[1])); }
    else if (bullet) { flush(); blocks.push(listItem("bulleted_list_item", bullet[1])); }
    else if (numbered) { flush(); blocks.push(listItem("numbered_list_item", numbered[1])); }
    else if (line.trim() === "") flush();
    else paragraphBuffer.push(line.trim());
  }
  flush();
  const truncated = blocks.length > MAX_BLOCKS;
  const result = truncated ? blocks.slice(0, MAX_BLOCKS - 1).concat(paragraph("(truncated: full content is in the repository)")) : blocks;
  return {blocks: result, truncated};
}
