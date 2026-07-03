// פונקציית שרת של Vercel - רצה רק כשמעבדים קבלה, לא נטענת לדפדפן של
// המשתמש בכלל, ולכן מפתח ה-API נשאר סודי בצד השרת.
//
// דורש משתנה סביבה בשם ANTHROPIC_API_KEY שמוגדר בהגדרות הפרויקט ב-Vercel
// (Settings -> Environment Variables). ראו הוראות מלאות ב-README.

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
    const { image } = req.body;
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'לא נשלחה תמונה' });
    }

    const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: 'פורמט תמונה לא תקין' });
    }
    const mediaType = match[1];
    const base64Data = match[2];

    const today = new Date().toISOString().slice(0, 10);

    const prompt = `זוהי תמונה של קבלה ממוסך רכב או חשבונית טיפול רכב בישראל.
חלץ מהתמונה את הפרטים הבאים והחזר אך ורק אובייקט JSON תקני, ללא שום טקסט נוסף, ללא Markdown, ללא הסברים:

{
  "date": "תאריך בפורמט YYYY-MM-DD. אם לא מופיע תאריך בקבלה, השתמש ב-${today}",
  "km": מספר שלם של הקילומטראז' של הרכב כפי שמופיע בקבלה (אם לא מופיע, שים 0),
  "part": "תיאור קצר בעברית של מה שבוצע/הוחלף (אם יש כמה פריטים, חבר אותם בפסיקים)",
  "price": מספר - הסכום הכולל לתשלום (ללא סימן מטבע, רק המספר),
  "sku": "מספר קטלוגי/מק\"ט אם מופיע, אחרת מחרוזת ריקה",
  "provider": "garage"
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
              { type: 'text', text: prompt },
            ],
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

    return res.status(200).json({
      date: parsed.date || today,
      km: parseInt(parsed.km) || 0,
      part: parsed.part || '',
      price: parseFloat(parsed.price) || 0,
      sku: parsed.sku || '',
      provider: parsed.provider === 'self' ? 'self' : 'garage',
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'שגיאה בעיבוד הבקשה' });
  }
};
