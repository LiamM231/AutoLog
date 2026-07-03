// מקבל טקסט CSV גולמי (מתוך גיליון אקסל שהמשתמש ייצא בעצמו, בכל מבנה
// עמודות שהוא), ומבקש מ-Claude לזהות ולמפות את הרשומות למבנה אחיד -
// ללא תלות בשמות עמודות, שפה או סדר.

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
    const { csv } = req.body;
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ error: 'לא נשלח תוכן קובץ' });
    }

    // הגבלת גודל כדי לא לחרוג ממגבלת הטוקנים - מספיק לכמה מאות שורות
    const trimmedCsv = csv.slice(0, 20000);
    const today = new Date().toISOString().slice(0, 10);

    const prompt = `הנה תוכן גולמי (CSV) של גיליון תיעוד טיפולי רכב שמשתמש ניהל בעצמו,
בכל מבנה או שפה - ייתכן שאין כותרות ברורות, שהעמודות בסדר לא צפוי,
או שיש טקסט חופשי. המשימה שלך: לזהות בכל שורה רשומת טיפול רכב (אם קיימת)
ולמפות אותה למבנה אחיד.

תוכן הקובץ:
"""
${trimmedCsv}
"""

החזר אך ורק אובייקט JSON תקני, ללא Markdown וללא הסברים:

{
  "records": [
    {
      "date": "YYYY-MM-DD - אם לא ידוע תאריך מדויק, נחש בצורה סבירה. אם אין שום מידע, השתמש ב-${today}",
      "km": מספר_שלם_קילומטראז',
      "part": "תיאור קצר בעברית של הטיפול/החלק שהוחלף",
      "price": מספר_מחיר (0 אם לא ידוע),
      "provider": "garage" או "self",
      "sku": "מק\"ט אם קיים, אחרת מחרוזת ריקה"
    }
  ]
}

התעלם משורות כותרת, שורות ריקות, או שורות שאינן רשומת טיפול בפועל.
אל תמציא רשומות שלא מבוססות על הטקסט שסופק.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
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
      return res.status(502).json({ error: 'לא הצלחנו לפרש את תשובת ה-AI. נסו קובץ קטן יותר.' });
    }

    const records = Array.isArray(parsed.records)
      ? parsed.records
          .filter((r) => r && Number.isFinite(Number(r.km)) && r.part)
          .map((r) => ({
            date: r.date || today,
            km: parseInt(r.km),
            part: String(r.part).trim(),
            price: parseFloat(r.price) || 0,
            provider: r.provider === 'self' ? 'self' : 'garage',
            sku: r.sku ? String(r.sku).trim() : '',
          }))
      : [];

    return res.status(200).json({ records });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'שגיאה בעיבוד הבקשה' });
  }
};
