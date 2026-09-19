import test from "node:test";
import assert from "node:assert/strict";
import { markdownToBlocks } from "../src/markdown.ts";
import { Notion } from "../src/notion.ts";
import { publish } from "../src/publish.ts";
import type { Config, Inventory } from "../src/model.ts";

test("markdown converts headings, lists, code fences, and paragraphs", () => {
  const {blocks, truncated} = markdownToBlocks(
    "# Title\n\nSome text.\nMore text.\n\n- one\n- two\n\n1. first\n\n```js\nconst x = 1;\n```\n"
  );
  assert.equal(truncated, false);
  assert.deepEqual(blocks.map((b: any) => b.type), ["heading_1","paragraph","bulleted_list_item","bulleted_list_item","numbered_list_item","code"]);
  assert.equal((blocks[0] as any).heading_1.rich_text[0].text.content, "Title");
  assert.equal((blocks[1] as any).paragraph.rich_text[0].text.content, "Some text. More text.");
  assert.equal((blocks[5] as any).code.rich_text[0].text.content, "const x = 1;");
});

test("markdown truncates excessive block counts", () => {
  const many = Array.from({length: 400}, (_, i) => "- item " + i).join("\n");
  const {blocks, truncated} = markdownToBlocks(many);
  assert.equal(truncated, true);
  assert(blocks.length <= 300);
});

test("publish mirrors thread and artifact body into page blocks and resyncs prior content", async () => {
  const config: Config = {repository:"example/team", branch:"main", notion:{version:"v", threads:"threads", tasks:"tasks", activity:"activity", dashboardBlock:"block"}};
  const calls: {method:string; path:string}[] = [];
  const api = new Notion("test", "v", async (url, init) => {
    const path = new URL(String(url)).pathname.replace("/v1/", "");
    const method = init?.method ?? "GET";
    calls.push({method, path});
    if (path.endsWith("/query")) return Response.json({results: [], has_more: false});
    if (method === "POST" && path === "pages") return Response.json({id: "new-page", properties: {}});
    if (path.startsWith("blocks/") && path.endsWith("/children") && method === "GET")
      return Response.json({results: [{id: "old-block"}], has_more: false});
    if (method === "DELETE") return Response.json({});
    if (method === "PATCH") return Response.json({});
    return Response.json({});
  });
  const data: Inventory = {
    threads: [{id:"THREAD-a", title:"Alpha", status:"active", path:"work/a/README.md", tags:[], body:"# Alpha\n\nHello."}],
    artifacts: [], events: [], warnings: []
  };
  const result = await publish(api, config, data, "abc");
  assert.deepEqual(result.errors, []);
  assert(calls.some(c => c.method === "GET" && c.path === "blocks/new-page/children"));
  assert(calls.some(c => c.method === "DELETE" && c.path === "blocks/old-block"));
  assert(calls.some(c => c.method === "PATCH" && c.path === "blocks/new-page/children"));
});

test("publish reports a warning when a body is truncated, not just the in-page notice", async () => {
  const config: Config = {repository:"example/team", branch:"main", notion:{version:"v", threads:"threads", tasks:"tasks", activity:"activity", dashboardBlock:"block"}};
  const api = new Notion("test", "v", async (url, init) => {
    const path = new URL(String(url)).pathname.replace("/v1/", "");
    const method = init?.method ?? "GET";
    if (path.endsWith("/query")) return Response.json({results: [], has_more: false});
    if (method === "POST" && path === "pages") return Response.json({id: "new-page", properties: {}});
    if (path.startsWith("blocks/") && path.endsWith("/children") && method === "GET")
      return Response.json({results: [], has_more: false});
    if (method === "DELETE") return Response.json({});
    if (method === "PATCH") return Response.json({});
    return Response.json({});
  });
  const longBody = Array.from({length: 400}, (_, i) => "- item " + i).join("\n");
  const data: Inventory = {
    threads: [{id:"THREAD-b", title:"Beta", status:"active", path:"work/b/README.md", tags:[], body:longBody}],
    artifacts: [], events: [], warnings: []
  };
  const result = await publish(api, config, data, "abc");
  assert.deepEqual(result.errors, []);
  assert(result.warnings.some(w => w.startsWith("THREAD-b:") && w.includes("truncated")));
});
