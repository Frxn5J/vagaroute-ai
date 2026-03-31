const body = { prompt: "a cat in space", size: "1024x1024" };
const targetModel = "flux";
const width = 1024, height = 1024, seed = 123;
const promptUrl = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(body.prompt)}`);
promptUrl.searchParams.set('model', targetModel);
promptUrl.searchParams.set('width', width.toString());
promptUrl.searchParams.set('height', height.toString());
promptUrl.searchParams.set('seed', seed.toString());
promptUrl.searchParams.set('nologo', 'true');

console.log("Fetching: " + promptUrl.toString());

const fetchPollinationsImage = async (url) => {
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(await res.text());
  console.log("Response headers:", res.headers.get("content-type"));
  const arrayBuffer = await res.arrayBuffer();
  console.log("ArrayBuffer length:", arrayBuffer.byteLength);
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  return { data: [{ b64_json: base64.slice(0, 50) + '...' }] };
};

fetchPollinationsImage(promptUrl.toString()).then(console.log).catch(console.error);
