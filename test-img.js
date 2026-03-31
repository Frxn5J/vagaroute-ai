const fetchUrl = async () => {
  console.log("Fetching...");
  const t = Date.now();
  try {
    const res = await fetch('https://image.pollinations.ai/prompt/hello?model=flux&width=1024&height=1024&seed=123&nologo=true', { method: 'GET' });
    console.log("Status:", res.status);
    const buf = await res.arrayBuffer();
    console.log("Buffer byteLength:", buf.byteLength);
  } catch(e) {
    console.error(e);
  }
  console.log("Done in ms:", Date.now() - t);
}
fetchUrl();
