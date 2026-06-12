const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('البوت شغال ✅');
});

app.listen(3000, () => {
  console.log('✅ سيرفر keep_alive شغال على بورت 3000');
});
