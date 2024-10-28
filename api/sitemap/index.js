// api/sitemap/index.js
const app = require("express")();
const axios = require("axios");

app.all("/", async (req, res) => {
  try {

    const data = await fetchDataFromAPI()

    //const hostUrl = `${req.protocol}://${req.get('host')}`;

    const hostUrl = data?.data?.client_base;

    let sitemap = `<?xml version='1.0' encoding='UTF-8'?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">`

    data?.data?.categories?.forEach(i => {
      sitemap += `<url>
           <loc>${hostUrl}/all/${i.slug}</loc>
          <lastmod>${i.updated_at}</lastmod>
        </url>`
    })

    data?.data?.products?.forEach(i => {
      sitemap += `<url>
          <loc>${hostUrl}/${i.slug}/product/${i.id}</loc>
          <lastmod>${i.updated_at}</lastmod>
        </url>`
    })

    sitemap += `</urlset>`

    res.set('Content-Type', 'application/xml');
    res.status(200).send(Buffer.from(sitemap));
  } catch (error) {
    res.status(500).send(error.message)
  }
})

async function fetchDataFromAPI() {
  try {
    const response = await axios.get(process.env.API_BASE + 'api/v1/page/sitemap');
    return response.data;
  } catch (error) {
    throw new Error("Failed to fetch data from the API");
  }
}

module.exports = app;
