module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  try {
    const body = req.body || {};
    const action = String(body?.action || '').trim();
    let fourMemeUrl = '';
    let fourMemeBody = null;
    let method = 'POST';

    if (action === 'rankings') {
      fourMemeUrl = 'https://four.meme/meme-api/v1/public/token/ranking';
      fourMemeBody = {
        type: String(body.type || 'HOT'),
        pageSize: Number(body.pageSize || 20),
        ...(body.symbol ? { symbol: body.symbol } : {}),
      };
    } else if (action === 'search') {
      fourMemeUrl = 'https://four.meme/meme-api/v1/public/token/search';
      fourMemeBody = {
        type: String(body.type || 'HOT'),
        listType: 'NOR',
        pageIndex: 1,
        pageSize: Number(body.pageSize || 20),
        status: 'ALL',
        sort: 'DESC',
        ...(body.keyword ? { keyword: body.keyword } : {}),
      };
    } else if (action === 'auth-nonce') {
      fourMemeUrl = 'https://four.meme/meme-api/v1/private/user/nonce/generate';
      fourMemeBody = {
        accountAddress: String(body.address || '').trim(),
        verifyType: 'LOGIN',
        networkCode: 'BSC',
      };
    } else if (action === 'auth-login') {
      fourMemeUrl = 'https://four.meme/meme-api/v1/private/user/login/dex';
      fourMemeBody = {
        region: 'WEB',
        langType: 'EN',
        loginIp: '',
        inviteCode: '',
        verifyInfo: {
          address: String(body.wallet || '').trim(),
          networkCode: 'BSC',
          signature: String(body.signature || '').trim(),
          verifyType: 'LOGIN',
        },
        walletName: 'MetaMask',
      };
    } else if (action === 'upload-image') {
      const imgUrlSrc = String(body.imageUrl || '').trim();
      const accessToken0 = String(body.accessToken || '').trim();
      if (!imgUrlSrc || !accessToken0) { res.status(400).json({ error: 'imageUrl and accessToken required' }); return; }
      const imgResp = await fetch(imgUrlSrc);
      if (!imgResp.ok) { res.status(400).json({ error: 'Could not fetch image: ' + imgResp.status }); return; }
      const imgBuf = await imgResp.arrayBuffer();
      const ct = imgResp.headers.get('content-type') || 'image/jpeg';
      const ext = ct.includes('png') ? 'image.png' : ct.includes('gif') ? 'image.gif' : ct.includes('webp') ? 'image.webp' : 'image.jpg';
      const form = new FormData();
      form.append('file', new Blob([imgBuf], { type: ct }), ext);
      const uploadResp = await fetch('https://four.meme/meme-api/v1/private/token/upload', {
        method: 'POST',
        headers: { 'meme-web-access': accessToken0, 'origin': 'https://four.meme', 'referer': 'https://four.meme/' },
        body: form,
      });
      const uploadData = await uploadResp.json().catch(() => ({}));
      res.status(200).json({ ok: true, data: uploadData });
      return;
    } else if (action === 'create-token-api') {
      fourMemeUrl = 'https://four.meme/meme-api/v1/private/token/create';
      const accessToken = String(body.accessToken || '').trim();
      let raisedToken = { symbol: 'BNB', totalBAmount: '18', totalAmount: '1000000000', saleRate: '0.8', status: 'PUBLISH' };
      try {
        const cfgRes = await fetch('https://four.meme/meme-api/v1/public/config');
        const cfgData = await cfgRes.json().catch(() => ({}));
        if (cfgData.code === 0 && Array.isArray(cfgData.data) && cfgData.data.length > 0) {
          const published = cfgData.data.filter(c => c.status === 'PUBLISH');
          const list = published.length > 0 ? published : cfgData.data;
          raisedToken = list.find(c => c.symbol === 'BNB') || list[0];
        }
      } catch (_) {}
      const validLabels = ['Meme','AI','Defi','Games','Infra','De-Sci','Social','Depin','Charity','Others'];
      const rawLabel = String(body.label || 'Meme');
      const labelCanonical = validLabels.find(l => l.toLowerCase() === rawLabel.toLowerCase()) || 'Meme';
      fourMemeBody = {
        name: body.name,
        shortName: body.symbol,
        desc: body.description,
        totalSupply: Number(raisedToken.totalAmount || 1000000000),
        raisedAmount: Number(raisedToken.totalBAmount || 18),
        saleRate: Number(raisedToken.saleRate || 0.8),
        reserveRate: 0,
        imgUrl: body.imageUrl,
        raisedToken,
        launchTime: Date.now(),
        funGroup: false,
        label: labelCanonical,
        lpTradingFee: 0.0025,
        preSale: String(body.devBuyBNB || '0'),
        clickFun: false,
        symbol: raisedToken.symbol,
        dexType: 'PANCAKE_SWAP',
        rushMode: false,
        onlyMPC: false,
        feePlan: false,
        ...(body.webUrl ? { webUrl: body.webUrl } : {}),
        ...(body.twitterUrl ? { twitterUrl: body.twitterUrl } : {}),
        ...(body.telegramUrl ? { telegramUrl: body.telegramUrl } : {}),
      };
      const fetchOpts2 = {
        method: 'POST',
        headers: { 'accept': 'application/json', 'content-type': 'application/json', 'meme-web-access': accessToken, 'origin': 'https://four.meme', 'referer': 'https://four.meme/' },
        body: JSON.stringify(fourMemeBody),
      };
      const resp2 = await fetch(fourMemeUrl, fetchOpts2);
      const data2 = await resp2.json().catch(() => ({}));
      res.status(200).json({ ok: true, data: data2 });
      return;
    } else if (action === 'token-info') {
      const addr = String(body.address || '').trim();
      if (!addr) { res.status(400).json({ error: 'address required' }); return; }
      fourMemeUrl = 'https://four.meme/meme-api/v1/private/token/get/v2?address=' + encodeURIComponent(addr);
      method = 'GET';
    } else {
      res.status(400).json({ error: 'Unknown action: ' + action });
      return;
    }

    const fetchOpts = {
      method,
      headers: { 'accept': 'application/json', 'content-type': 'application/json', 'origin': 'https://four.meme', 'referer': 'https://four.meme/' },
    };
    if (method === 'POST' && fourMemeBody) fetchOpts.body = JSON.stringify(fourMemeBody);
    const resp = await fetch(fourMemeUrl, fetchOpts);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { res.status(resp.status).json({ error: data?.message || data?.msg || 'four.meme error' }); return; }
    res.status(200).json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Internal error' });
  }
};
