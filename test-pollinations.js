const response = await fetch('https://gen.pollinations.ai/v1/images/generations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'hello', model: 'flux' })
});
console.log(response.status);
console.log(await response.text());
