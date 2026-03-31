const fetchUrl = async (url) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'hello', model: 'flux' })
  });
  console.log('---', url, '---');
  console.log(response.status);
  console.log(await response.text());
}

await fetchUrl('https://image.pollinations.ai/openai/v1/images/generations');
await fetchUrl('https://image.pollinations.ai/prompt/hello');
await fetchUrl('https://text.pollinations.ai/openai/v1/images/generations');
