// Evaluates one expression in the managed dev browser's page and prints it as JSON, for emulator checks.
// Needs the dev server started with --allow-browser-automation.
// Usage: XR_EVAL="window.__orrery.state.phase.value" npx @iwsdk/cli browser run tools/xr-eval.mjs
export default async function run({ page, frame }) {
  const expression = process.env.XR_EVAL;
  if (!expression) throw new Error('Set XR_EVAL to the expression to evaluate.');
  const result = await (frame ?? page).evaluate(expression);
  console.log(JSON.stringify(result));
  return result;
}
