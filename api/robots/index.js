// api/sitemap/index.js
const app = require("express")();

app.all("/", async (req, res) => {
  try {


    const hostUrl = `${req.protocol}://${req.get('host')}`;



    const robotsTxtContent = `User-agent: *
    
SiteMap: ${hostUrl}/sitemap.xml

User-agent: BUbiNG
User-agent: Genieo
User-agent: grapeshot
User-agent: JamesBOT
User-agent: ltx71 - (http://ltx71.com/)
User-agent: MJ12bot
User-agent: SeznamBot
User-agent: dotbot
User-agent: CCBot
User-agent: TinEye-bot
User-agent: PubMatic Crawler Bot
User-agent: mappydata
User-agent: Jooblebot
User-agent: grapeshot
User-agent: DomainStatsBot
User-agent: PubMaticCrawlerBot
Disallow: /`;



    res.set('Content-Type', 'text/plain');
    res.status(200).send(robotsTxtContent);
  } catch (error) {
    res.status(500).send(error.message)
  }
})

module.exports = app;
