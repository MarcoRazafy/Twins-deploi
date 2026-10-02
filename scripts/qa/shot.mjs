#!/usr/bin/env node
// Screenshot + scripted-interaction CLI for visual QA.
//
// Usage
//   node scripts/qa/shot.mjs --url /dashboard --out /tmp/dashboard.png
//   node scripts/qa/shot.mjs --url /projects --out /tmp/p.png --mobile --full
//   node scripts/qa/shot.mjs --url /projects --out /tmp/dialog.png \
//     --actions '[{"click":"role=button[name=/nouveau projet/i]"},{"wait":400}]'
//
// Options
//   --url <path>        Path (or absolute URL) to open. Required.
//   --out <file.png>    Final screenshot. Required.
//   --width / --height  Viewport (default 1440x900).
//   --mobile            390x844 touch viewport.
//   --full              Full-page screenshot.
//   --wait <ms>         Extra delay before the final screenshot (default 400).
//   --reduced-motion    Emulate prefers-reduced-motion.
//   --actions <json>    Steps run before the final screenshot. Each step is an
//                       object with ONE of:
//       {"click": "<selector>"}            {"dblclick": "<selector>"}
//       {"rightClick": "<selector>"}       {"hover": "<selector>"}
//       {"fill": ["<selector>", "text"]}   {"type": "text"}
//       {"press": "Enter"}                 (any Playwright key, e.g. "Control+K")
//       {"select": ["<selector>", "value"]}
//       {"drag": ["<selector>", dx, dy]}   (mouse drag by an offset)
//       {"wheel": [dx, dy]}                {"scrollTo": ["<selector>", y]}
//       {"goto": "/path"}                  {"wait": 300}
//       {"waitFor": "<selector>"}          {"settle": 300}
//       {"shot": "/tmp/step.png"}          (intermediate screenshot)
//       {"eval": "document.title"}         (prints the JSON result)
//       {"text": "<selector>"}             (prints innerText)
//       {"count": "<selector>"}            (prints the number of matches)
//
// Selectors are Playwright selectors: CSS, `text=Projets`,
// `role=button[name="Créer"]`, `[data-testid=…]`…
//
// The script prints console errors/warnings, page errors and failed requests,
// and exits with code 1 when an action fails.

import { withPage } from "./browser.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.url || !args.out) {
  console.error("Usage: node scripts/qa/shot.mjs --url <path> --out <file.png> [options]");
  process.exit(2);
}

const actions = args.actions ? JSON.parse(String(args.actions)) : [];

async function runAction(page, helpers, action) {
  if ("click" in action) return page.locator(action.click).first().click();
  if ("dblclick" in action) return page.locator(action.dblclick).first().dblclick();
  if ("rightClick" in action)
    return page.locator(action.rightClick).first().click({ button: "right" });
  if ("hover" in action) return page.locator(action.hover).first().hover();
  if ("fill" in action) return page.locator(action.fill[0]).first().fill(action.fill[1]);
  if ("type" in action) return page.keyboard.type(action.type, { delay: 20 });
  if ("press" in action) return page.keyboard.press(action.press);
  if ("select" in action)
    return page.locator(action.select[0]).first().selectOption(action.select[1]);
  if ("drag" in action) {
    const [selector, dx, dy] = action.drag;
    const box = await page.locator(selector).first().boundingBox();
    if (!box) throw new Error(`drag: no bounding box for ${selector}`);
    const startX = box.x + box.width / 2;
    const startY = box.y + Math.min(box.height / 2, 24);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + dx / 2, startY + dy / 2, { steps: 8 });
    await page.mouse.move(startX + dx, startY + dy, { steps: 8 });
    await page.mouse.up();
    return undefined;
  }
  if ("wheel" in action) return page.mouse.wheel(action.wheel[0], action.wheel[1]);
  if ("scrollTo" in action) {
    const [selector, top] = action.scrollTo;
    return page.locator(selector).first().evaluate((node, y) => node.scrollTo({ top: y }), top);
  }
  if ("goto" in action) return helpers.goto(action.goto);
  if ("wait" in action) return page.waitForTimeout(action.wait);
  if ("waitFor" in action) return page.locator(action.waitFor).first().waitFor();
  if ("settle" in action) return helpers.settle(action.settle);
  if ("shot" in action) return helpers.shot(action.shot);
  if ("eval" in action) {
    const result = await page.evaluate(action.eval);
    console.log(`eval: ${JSON.stringify(result)}`);
    return undefined;
  }
  if ("text" in action) {
    const text = await page.locator(action.text).first().innerText();
    console.log(`text(${action.text}): ${JSON.stringify(text)}`);
    return undefined;
  }
  if ("count" in action) {
    const count = await page.locator(action.count).count();
    console.log(`count(${action.count}): ${count}`);
    return undefined;
  }
  throw new Error(`Unknown action: ${JSON.stringify(action)}`);
}

let failed = false;

await withPage(
  async (page, helpers) => {
    await helpers.goto(String(args.url));
    for (const action of actions) {
      try {
        await runAction(page, helpers, action);
      } catch (error) {
        failed = true;
        console.log(`ACTION FAILED ${JSON.stringify(action)}: ${error.message.split("\n")[0]}`);
        break;
      }
    }
    await page.waitForTimeout(Number(args.wait ?? 400));
    await helpers.shot(String(args.out), { fullPage: Boolean(args.full) });
  },
  {
    width: args.width ? Number(args.width) : undefined,
    height: args.height ? Number(args.height) : undefined,
    mobile: Boolean(args.mobile),
    reducedMotion: Boolean(args["reduced-motion"]),
  },
);

process.exit(failed ? 1 : 0);
