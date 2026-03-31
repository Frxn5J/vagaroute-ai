const fetchUrl = async () => {
  try {
    const res = await fetch('http://localhost:3000/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello world', model: 'flux' })
    });
    console.log(res.status);
    console.log(await res.text());
  } catch(e) {
    console.error(e);
  }
}
fetchUrl();
