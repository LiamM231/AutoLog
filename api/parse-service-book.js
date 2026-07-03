// מנתח עמודי ספר רכב (עד 6 תמונות בבקשה אחת) ומחלץ מרווחי טיפול
// מומלצים על ידי היצרן, לפי ק"מ.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'לא הוגדר מפתח API בשרת. יש להוסיף ANTHROPIC_API_KEY בהגדרות הפרויקט ב-Vercel.',
    });
  }

  try {
    const { images } = req.body;
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'לא נשלחו תמונות' });
    }

    const limitedImages = images.slice(0, 6);
    const imageBlocks = [];
    for (const image of limitedImages) {
      const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!match) continue;
      imageBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: match[1], data: match[2] },
      });
    }

    if (imageBlocks.length === 0) {
      return res.status(400).json({ error: 'פורמט תמונה לא תקין' });
    }

    const prompt = `אלו תמונות של עמודים מספר רכב / חוברת תחזוקה (ייתכן שבעברית או באנגלית).
חלץ מהן את טבלת מרווחי הטיפול המומלצים על ידי היצרן, לפי קילומטראז'.
החזר אך ורק אובייקט JSON תקני, ללא שום טקסט נוסף, ללא Markdown:

{
  "manufacturer": "שם היצרן והדגם אם מזוהה, אחרת מחרוזת ריקה",
  "intervals": [
    { "label": "שם קצר בעברית של הטיפול (למשל: שמן ומסנן שמן)", "intervalKm": מספר_שלם_של_מרווח_בקמ }
  ]
}

אם לא ניתן לזהות מרווחי טיפול ברורים בתמונות, החזר "intervals": [] וב-manufacturer הסבר קצר מדוע (למשל "לא נמצאה טבלת תחזוקה בתמונות").
כלול רק פריטים עם מספר ק"מ ברור. אל תמציא נתונים.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1200,
        messages: [
          {
            role: 'user',
            content: [...imageBlocks, { type: 'text', text: prompt }],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', errText);
      return res.status(502).json({ error: 'שגיאה בפנייה לשירות ה-AI' });
    }

    const data = await response.json();
    const textBlock = data.content?.find((b) => b.type === 'text');
    if (!textBlock) {
      return res.status(502).json({ error: 'לא התקבלה תשובה תקינה' });
    }

    const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('JSON parse failed:', cleaned);
      return res.status(502).json({ error: 'לא הצלחנו לפרש את תשובת ה-AI' });
    }

    const intervals = Array.isArray(parsed.intervals)
      ? parsed.intervals
          .filter((it) => it && it.label && Number.isFinite(Number(it.intervalKm)) && Number(it.intervalKm) > 0)
          .map((it) => ({ label: String(it.label).trim(), intervalKm: parseInt(it.intervalKm) }))
      : [];

    return res.status(200).json({
      manufacturer: parsed.manufacturer || '',
      intervals,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'שגיאה בעיבוד הבקשה' });
  }
};
