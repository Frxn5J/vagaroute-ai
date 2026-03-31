const fs = require('fs');

const fetchUrl = async (url) => {
  let out = `--- ${url} ---\n`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello', model: 'flux' })
    });
    out += `${response.status}\n${await response.text()}\n\n`;
  } catch (err) {
    out += `Error: ${err.message}\n\n`;
  }
  fs.appendFileSync('test-output.log', out);
}

const run = async () => {
  fs.writeFileSync('test-output.log', '');
  await fetchUrl('https://image.pollinations.ai/openai/v1/images/generations');
  // text compatibility endpoint
  await fetchUrl('https://text.pollinations.ai/openai/v1/images/generations');
  // the main new generation endpoint currently in code
  await fetchUrl('https://gen.pollinations.ai/v1/images/generations');
};
run();
