// Hands an image from one tool to another inside the page: the receiving tool picks it up
// when its page is shown. Nothing leaves the browser.
const box = new Map();

export function sendTo(tool, item) {
  box.set(tool, item);
  location.hash = '#' + tool;
}

export function receive(tool) {
  const item = box.get(tool);
  box.delete(tool);
  return item;
}
