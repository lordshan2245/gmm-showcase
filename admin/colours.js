function hexToRgb(hex) { var n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join('');
}
function lum(rgb) { return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255; }
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b), h = 0, s = 0, l = (max + min) / 2, d = max - min;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, s, l];
}
function hslToHex(h, s, l) {
  var f = function (n) {
    var k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return rgbToHex(f(0), f(8), f(4));
}

// Finds the logo's most common vivid colour (accent) and a deep tint of it (background).
function coloursFromLogo(url) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () {
      var size = 96, c = document.createElement('canvas');
      c.width = c.height = size;
      var x = c.getContext('2d');
      x.drawImage(img, 0, 0, size, size);
      var d;
      try { d = x.getImageData(0, 0, size, size).data; } catch (e) { return reject(new Error('Could not read the logo image.')); }
      var buckets = {};
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        var hsl = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        if (hsl[1] < 0.35 || hsl[2] < 0.25 || hsl[2] > 0.8) continue; // skip greys, near-black, near-white
        var key = (d[i] >> 4) + '-' + (d[i + 1] >> 4) + '-' + (d[i + 2] >> 4);
        var b = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0 });
        b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2];
      }
      var best = null;
      Object.keys(buckets).forEach(function (k) { if (!best || buckets[k].n > best.n) best = buckets[k]; });
      if (!best) return reject(new Error('The logo has no strong colour to pick — choose the colours by hand.'));
      var r = best.r / best.n, g = best.g / best.n, bl = best.b / best.n;
      var h = rgbToHsl(r, g, bl)[0];
      resolve({ accent: rgbToHex(r, g, bl), bg: hslToHex(h, 0.4, 0.07) });
    };
    img.onerror = function () { reject(new Error('Could not load the logo image.')); };
    img.src = url;
  });
}

