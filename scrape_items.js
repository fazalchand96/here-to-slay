const fs = require('fs');
const https = require('https');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const contentMd = fs.readFileSync('C:/Users/c.fazal/.gemini/antigravity-ide/brain/32d7164d-a44e-4076-ae4c-821b352b30de/.system_generated/steps/1286/content.md', 'utf8');

// Parse content.md
const dom = new JSDOM(contentMd);
const lists = dom.window.document.querySelectorAll('ul');

let cardLinks = [];
let capture = false;
// We need Items, Cursed Items, Modifiers, Magic.
// The lists in the markdown are preceded by <li><strong>Category</strong>
lists.forEach(ul => {
    const boldText = ul.querySelector('strong')?.textContent;
    if (['Items', 'Cursed Items', 'Modifiers', 'Magic'].includes(boldText)) {
        const links = ul.querySelectorAll('li > ul > li > a');
        links.forEach(a => {
            const url = 'https://www.unstablegameswiki.com' + a.getAttribute('href');
            const name = a.textContent.trim();
            // Determine type from boldText
            let type = '';
            if (boldText === 'Items') type = 'Item Card';
            if (boldText === 'Cursed Items') type = 'Cursed Item Card';
            if (boldText === 'Modifiers') type = 'Modifier Card';
            if (boldText === 'Magic') type = 'Magic Card';
            cardLinks.push({ url, name, type });
        });
    }
});

async function fetchCardText(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const dom = new JSDOM(data);
                const doc = dom.window.document;
                const h2s = doc.querySelectorAll('h2');
                let mainInfo = null;
                for (const h2 of h2s) {
                    if (h2.textContent.includes('Main Information')) {
                        mainInfo = h2;
                        break;
                    }
                }
                if (mainInfo) {
                    let next = mainInfo.nextElementSibling;
                    let text = '';
                    while (next && next.tagName !== 'H2') {
                        text += ' ' + next.textContent;
                        next = next.nextElementSibling;
                    }
                    text = text.replace(/KS Print n Play Edition\/Base Deck\/2nd Edition Base:/g, '').trim();
                    resolve(text);
                } else {
                    resolve('');
                }
            });
        }).on('error', reject);
    });
}

async function run() {
    console.log(`Found ${cardLinks.length} cards to scrape.`);
    const cardsJson = JSON.parse(fs.readFileSync('cards.json', 'utf8'));
    
    for (const cl of cardLinks) {
        console.log(`Fetching ${cl.name}...`);
        const text = await fetchCardText(cl.url);
        
        let effectId = cl.type.split(' ')[0].toUpperCase() + '_' + cl.name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
        effectId = effectId.replace(/__+/g, '_').replace(/^_|_$/g, '');
        
        let modifierValues = [];
        if (cl.type === 'Modifier Card') {
            const matches = cl.name.match(/[+-]\d/g);
            if (matches) {
                modifierValues = matches.map(m => parseInt(m, 10));
            }
        }
        
        // Update cards in cards.json
        for (let i = 0; i < cardsJson.length; i++) {
            if (cardsJson[i].name === cl.name && cardsJson[i].type === cl.type) {
                cardsJson[i].description = text;
                cardsJson[i].effect_id = effectId;
                if (cl.type === 'Modifier Card') {
                    cardsJson[i].modifier_values = modifierValues;
                }
            }
        }
        // Small delay to prevent rate limit
        await new Promise(r => setTimeout(r, 100));
    }
    
    fs.writeFileSync('cards.json', JSON.stringify(cardsJson, null, 2));
    console.log('Finished updating cards.json');
}

run();
