import { jsPDF } from "jspdf";
import { pdfFonts } from "./pdf-fonts.js";

const hexToRgb = (hex) => {
  const value = /^#([\da-f]{6})$/i.exec(String(hex || ""))?.[1] || "ffffff";
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
};

const mixHex = (base, foreground, amount) => {
  const first = hexToRgb(base);
  const second = hexToRgb(foreground);
  const rgb = first.map((channel, index) => Math.round(channel * (1 - amount) + second[index] * amount));
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
};

const safeFilename = (name) => {
  const slug = String(name || "question-set")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `${slug || "question-set"}.pdf`;
};

async function loadImage(source, opacity = 1) {
  if (!source) return null;
  try {
    const image = new Image();
    const parsed = new URL(source, window.location.href);
    if (parsed.origin !== window.location.origin) image.crossOrigin = "anonymous";
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.globalAlpha = opacity;
    context.drawImage(image, 0, 0);
    return {
      data: canvas.toDataURL("image/png"),
      ratio: image.naturalWidth / Math.max(1, image.naturalHeight),
    };
  } catch {
    // Cross-origin images without CORS permission are omitted rather than failing export.
    return null;
  }
}

function renderWatermarkText({ text, fontFamily, fontSizePt, color, opacity, maxWidthMm }) {
  try {
    const measureCanvas = document.createElement("canvas");
    const measureContext = measureCanvas.getContext("2d");
    if (!measureContext) return null;
    const rtl = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u.test(text);
    let fontPx = fontSizePt * 96 / 72;
    measureContext.direction = rtl ? "rtl" : "ltr";
    measureContext.font = `600 ${fontPx}px ${fontFamily}`;
    const maximumWidthPx = Math.max(32, maxWidthMm * 96 / 25.4);
    const lines = [];
    let currentLine = "";
    for (const word of String(text).trim().split(/\s+/u).filter(Boolean)) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (currentLine && measureContext.measureText(candidate).width > maximumWidthPx - 6) {
        lines.push(currentLine);
        currentLine = word;
      } else currentLine = candidate;
    }
    if (currentLine) lines.push(currentLine);
    const lineWidths = lines.map((line) => measureContext.measureText(line).width);
    const logicalWidth = Math.min(maximumWidthPx, Math.max(24, ...lineWidths) + 6);
    const lineHeight = fontPx * 1.5;
    const logicalHeight = Math.max(lineHeight, lines.length * lineHeight);
    const scale = 3;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(logicalWidth * scale);
    canvas.height = Math.ceil(logicalHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.scale(scale, scale);
    context.direction = rtl ? "rtl" : "ltr";
    context.textAlign = rtl ? "right" : "left";
    context.textBaseline = "middle";
    context.font = `600 ${fontPx}px ${fontFamily}`;
    context.fillStyle = color;
    context.globalAlpha = opacity;
    lines.forEach((line, index) => {
      context.fillText(line, rtl ? logicalWidth - 3 : 3, lineHeight * (index + 0.5), logicalWidth - 6);
    });
    return {
      data: canvas.toDataURL("image/png"),
      width: logicalWidth * 25.4 / 96,
      height: logicalHeight * 25.4 / 96,
    };
  } catch {
    return null;
  }
}

async function rotateRasterImage(raster, angleDegrees) {
  if (!raster || !angleDegrees) return raster;
  try {
    const image = new Image();
    image.src = raster.data;
    await image.decode();
    const radians = angleDegrees * Math.PI / 180;
    const cosine = Math.abs(Math.cos(radians));
    const sine = Math.abs(Math.sin(radians));
    const outputWidth = Math.ceil(image.naturalWidth * cosine + image.naturalHeight * sine);
    const outputHeight = Math.ceil(image.naturalWidth * sine + image.naturalHeight * cosine);
    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d");
    if (!context) return raster;
    context.translate(outputWidth / 2, outputHeight / 2);
    context.rotate(radians);
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
    const millimetersPerPixel = raster.width / image.naturalWidth;
    return {
      data: canvas.toDataURL("image/png"),
      width: outputWidth * millimetersPerPixel,
      height: outputHeight * millimetersPerPixel,
    };
  } catch {
    return raster;
  }
}

async function composeWatermarkRaster({ image, text, align, tilt }) {
  if (!image && !text) return null;
  try {
    const scale = 96 / 25.4;
    const gap = image && text ? 5 / scale : 0;
    const width = Math.max(image?.width || 0, text?.width || 0);
    const height = (image?.height || 0) + (text?.height || 0) + gap;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(width * scale));
    canvas.height = Math.max(1, Math.ceil(height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;

    const loadRaster = async (raster) => {
      if (!raster) return null;
      const element = new Image();
      element.src = raster.data;
      await element.decode();
      return element;
    };
    const [imageElement, textElement] = await Promise.all([loadRaster(image), loadRaster(text)]);
    let y = 0;
    for (const [raster, element] of [[image, imageElement], [text, textElement]]) {
      if (!raster || !element) continue;
      const rasterWidth = raster.width * scale;
      const rasterHeight = raster.height * scale;
      const x = align === "right" ? canvas.width - rasterWidth : align === "center" ? (canvas.width - rasterWidth) / 2 : 0;
      context.drawImage(element, x, y, rasterWidth, rasterHeight);
      y += rasterHeight + gap;
    }

    const combined = {
      data: canvas.toDataURL("image/png"),
      width: canvas.width / scale,
      height: canvas.height / scale,
    };
    return tilt ? rotateRasterImage(combined, -25) : combined;
  } catch {
    return null;
  }
}

export async function downloadQuestionSetPdf({ test, questions, settings, pageBackground, textColor, accentColor, theme = {} }) {
  const paper = { A4: "a4", Letter: "letter", Legal: "legal" }[settings.paperSize] || "a4";
  const orientation = settings.orientation === "landscape" ? "landscape" : "portrait";
  const columns = settings.columns === "1" ? 1 : 2;
  const classic = theme.layout === "classic";
  const fontChoice = pdfFonts[settings.pdfFont] ? settings.pdfFont : "helvetica";
  const fontSpec = pdfFonts[fontChoice];
  const fontFamily = fontSpec.native;
  const rasterPdfFont = Boolean(fontSpec.raster);
  const canvasFontFamily = fontSpec.family;
  const watermarkScale = { small: 0.7, medium: 1, large: 1.4 }[settings.watermarkSize] || 1;
  const watermarkTilt = Boolean(settings.watermarkTilt);
  const pdf = new jsPDF({ orientation, unit: "mm", format: paper, compress: true });
  pdf.setProperties({ title: test.name });

  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const margin = 12.7;
  const bottom = height - 18;
  const columnGap = columns === 2 ? (classic ? 10.5 : 6) : 0;
  const columnWidth = (width - margin * 2 - columnGap) / columns;
  const mutedColor = classic ? "#6b7280" : theme.mutedColor || mixHex(pageBackground, textColor, 0.6);
  const titleColor = classic ? "#111827" : theme.titleColor || textColor;
  const optionTextColor = classic ? "#374151" : textColor;
  const optionMarkerColor = classic ? "#6b7280" : theme.optionMarkerColor || accentColor;
  const borderColor = classic ? "#e5e7eb" : theme.borderColor || mixHex(pageBackground, accentColor, 0.24);
  const cardColor = mixHex(pageBackground, textColor, 0.035);
  const answerColor = classic ? "#059669" : theme.answerColor || mixHex(pageBackground, "#245b37", 0.9);
  const answerFill = mixHex(pageBackground, answerColor, 0.12);
  const answerText = answerColor;
  const imageCache = new Map();
  const watermarkOpacity = Math.max(0, Math.min(1, Number(settings.watermarkOpacity) || 0));

  const imageFor = async (url, imageOpacity = 1) => {
    if (!url) return null;
    const cacheKey = `${url}|${imageOpacity}`;
    if (!imageCache.has(cacheKey)) imageCache.set(cacheKey, loadImage(url, imageOpacity));
    return imageCache.get(cacheKey);
  };

  const customMeasureContext = rasterPdfFont ? document.createElement("canvas").getContext("2d") : null;
  const pxPerMm = 96 / 25.4;
  const canvasFont = (fontSizePt, bold) => `${bold ? 700 : 400} ${fontSizePt * 96 / 72}px ${canvasFontFamily}`;
  const splitText = (value, maxWidthMm, fontSizePt, bold) => {
    const text = String(value ?? "");
    if (!rasterPdfFont || !customMeasureContext) {
      pdf.setFont(fontFamily, bold ? "bold" : "normal");
      pdf.setFontSize(fontSizePt);
      return pdf.splitTextToSize(text, maxWidthMm);
    }

    customMeasureContext.font = canvasFont(fontSizePt, bold);
    const maxWidthPx = maxWidthMm * pxPerMm;
    const lines = [];
    for (const paragraph of text.replace(/\r/g, "").split("\n")) {
      const words = paragraph.trim().split(/\s+/).filter(Boolean);
      if (!words.length) {
        lines.push("");
        continue;
      }
      let line = "";
      for (const word of words) {
        if (customMeasureContext.measureText(word).width > maxWidthPx) {
          if (line) lines.push(line);
          line = "";
          let part = "";
          for (const character of word) {
            if (part && customMeasureContext.measureText(part + character).width > maxWidthPx) {
              lines.push(part);
              part = character;
            } else part += character;
          }
          line = part;
          continue;
        }
        const candidate = line ? `${line} ${word}` : word;
        if (line && customMeasureContext.measureText(candidate).width > maxWidthPx) {
          lines.push(line);
          line = word;
        } else line = candidate;
      }
      if (line) lines.push(line);
    }
    return lines.length ? lines : [""];
  };

  const addText = (value, x, baselineY, { fontSizePt, bold, color, align = "left", lineHeightMm }) => {
    const lines = Array.isArray(value) ? value.map((line) => String(line ?? "")) : [String(value ?? "")];
    if (!rasterPdfFont || !customMeasureContext) {
      pdf.setFont(fontFamily, bold ? "bold" : "normal");
      pdf.setFontSize(fontSizePt);
      pdf.setTextColor(...hexToRgb(color));
      pdf.text(lines, x, baselineY, align === "left" ? undefined : { align });
      return;
    }

    customMeasureContext.font = canvasFont(fontSizePt, bold);
    const fontPx = fontSizePt * 96 / 72;
    const paddingPx = 3;
    const lineWidths = lines.map((line) => customMeasureContext.measureText(line).width);
    const logicalWidthPx = Math.max(1, ...lineWidths) + paddingPx * 2;
    const lineHeightPx = (lineHeightMm || fontSizePt * 25.4 / 72 * 1.2) * pxPerMm;
    const metrics = customMeasureContext.measureText("Mg");
    const ascentPx = Math.max(fontPx * 0.8, metrics.actualBoundingBoxAscent || 0);
    const descentPx = Math.max(fontPx * 0.25, metrics.actualBoundingBoxDescent || 0);
    const baselinePx = ascentPx + 1;
    const logicalHeightPx = Math.max(fontPx * 1.35, baselinePx + descentPx + (lines.length - 1) * lineHeightPx + 2);
    const resolution = 3;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(logicalWidthPx * resolution);
    canvas.height = Math.ceil(logicalHeightPx * resolution);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(resolution, resolution);
    context.font = canvasFont(fontSizePt, bold);
    context.fillStyle = color;
    context.textBaseline = "alphabetic";
    context.textAlign = align;
    const textX = align === "right" ? logicalWidthPx - paddingPx : align === "center" ? logicalWidthPx / 2 : paddingPx;
    lines.forEach((line, index) => context.fillText(line, textX, baselinePx + index * lineHeightPx));

    const imageWidthMm = canvas.width / (resolution * pxPerMm);
    const imageHeightMm = canvas.height / (resolution * pxPerMm);
    const imageX = align === "right" ? x - imageWidthMm : align === "center" ? x - imageWidthMm / 2 : x;
    const imageY = baselineY - baselinePx / pxPerMm;
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", imageX, imageY, imageWidthMm, imageHeightMm, undefined, "FAST");
  };

  const title = test.name || "Question set";
  pdf.setFont(fontFamily, "bold");
  pdf.setFontSize(classic ? 18 : 21);
  const titleLines = splitText(title, width - margin * 2, classic ? 18 : 21, true);
  const firstContentTop = classic ? 52 + (titleLines.length - 1) * 7 : 40 + titleLines.length * 8;

  const createPageLayout = (firstPage = false) => ({
    firstPage,
    contentTop: firstPage ? firstContentTop : (classic ? margin : 22),
    columns: Array.from({ length: columns }, () => []),
  });

  const paintBackground = () => {
    pdf.setFillColor(...hexToRgb(pageBackground));
    pdf.rect(0, 0, width, height, "F");
    if (!classic) {
      pdf.setFillColor(...hexToRgb(accentColor));
      pdf.rect(0, 0, width, 2.2, "F");
    }
  };

  let hasStartedPage = false;
  const startPage = (firstPage = false) => {
    if (hasStartedPage) pdf.addPage(paper, orientation);
    hasStartedPage = true;
    paintBackground();
    if (firstPage) {
      addText(titleLines, classic ? width / 2 : margin, 25, {
        fontSizePt: classic ? 18 : 21,
        bold: true,
        color: titleColor,
        align: classic ? "center" : "left",
        lineHeightMm: classic ? 7 : 8,
      });
      const titleHeight = titleLines.length * (classic ? 7 : 8);
      const countText = classic ? `Total Questions: ${questions.length}` : `${questions.length} ${questions.length === 1 ? "question" : "questions"}`;
      addText(countText, classic ? width / 2 : margin, (classic ? 29 : 28) + titleHeight, {
        fontSizePt: classic ? 10.5 : 9,
        bold: false,
        color: mutedColor,
        align: classic ? "center" : "left",
        lineHeightMm: 5,
      });
      pdf.setDrawColor(...hexToRgb(borderColor));
      pdf.setLineWidth(0.45);
      pdf.line(margin, (classic ? 37 : 33) + titleHeight, width - margin, (classic ? 37 : 33) + titleHeight);
    }
  };

  const questionImages = await Promise.all(questions.map((question) => imageFor(question.imageUrl)));
  const preparedQuestions = questions.map((question, index) => {
    const innerWidth = columnWidth - (classic ? 0 : 12);
    const questionFontSize = classic ? 12 : 10.5;
    const optionFontSize = classic ? 10.5 : 8.5;
    const answerFontSize = classic ? 10.5 : 8.5;
    const questionLineHeight = classic ? 6 : 5;
    const optionLineHeight = classic ? 5.5 : 4.5;
    const questionLabel = classic ? `${index + 1}. ${question.question || ""}` : `${String(index + 1).padStart(2, "0")}  ${question.question || ""}`;
    const questionLines = splitText(questionLabel, innerWidth, questionFontSize, true);
    const optionEntries = question.type === "mc" && Array.isArray(question.options)
      ? question.options.map((option, optionIndex) => ({
          marker: `${String.fromCharCode(65 + optionIndex)}.`,
          lines: splitText(String(option ?? ""), innerWidth - (classic ? 6 : 9), optionFontSize, false),
        }))
      : [];
    const answerValue = String(question.answer ?? "").trim() || "—";
    const answerLines = settings.includeAnswers
      ? splitText(`Answer: ${answerValue}`, classic ? innerWidth : innerWidth - 6, answerFontSize, true)
      : [];
    const image = questionImages[index];
    const imageHeight = image ? Math.min(classic ? Infinity : 34, (columnWidth - (classic ? 0 : 14)) / Math.max(0.1, image.ratio)) : 0;
    const classicQuestionSpace = questionLines.length * questionLineHeight + 2.7;
    const classicOptionsSpace = optionEntries.reduce((total, option) => total + Math.max(1, option.lines.length) * optionLineHeight + (classic ? 1.1 : 2), 0);
    const classicAnswerSpace = answerLines.length ? answerLines.length * optionLineHeight + 5.5 : 0;
    const classicImageSpace = imageHeight ? imageHeight + 2.7 : 0;
    const cardHeight = classic
      ? 4 + classicImageSpace + classicQuestionSpace + classicOptionsSpace + (optionEntries.length ? 2.7 : 0) + classicAnswerSpace
      : 11 + questionLines.length * questionLineHeight + (imageHeight ? imageHeight + 5 : 0)
        + optionEntries.reduce((total, option) => total + Math.max(1, option.lines.length) * optionLineHeight + 2, 0)
        + (answerLines.length ? answerLines.length * optionLineHeight + 8 : 0);
    return { question, questionLines, optionEntries, answerLines, image, imageHeight, cardHeight, questionFontSize, optionFontSize, answerFontSize, questionLineHeight, optionLineHeight };
  });

  const pageLayouts = [createPageLayout(true)];
  let activePage = pageLayouts[0];
  let activeColumn = 0;
  for (const item of preparedQuestions) {
    while (true) {
      const columnItems = activePage.columns[activeColumn];
      const questionGap = classic ? 5.3 : 5;
      const usedHeight = columnItems.reduce((total, current) => total + current.cardHeight, 0)
        + Math.max(0, columnItems.length - 1) * questionGap;
      const availableHeight = bottom - activePage.contentTop;
      if (!columnItems.length || usedHeight + questionGap + item.cardHeight <= availableHeight) break;
      if (activeColumn < columns - 1) {
        activeColumn += 1;
        continue;
      }
      activePage = createPageLayout(false);
      pageLayouts.push(activePage);
      activeColumn = 0;
    }
    activePage.columns[activeColumn].push(item);
  }

  const drawQuestion = (item, index, pageIndex, columnIndex, cardY, availableHeight) => {
    const cardX = margin + columnIndex * (columnWidth + columnGap);
    const cardWidth = columnWidth;
    const actualHeight = Math.min(item.cardHeight, availableHeight);
    if (!classic) {
      pdf.setFillColor(...hexToRgb(cardColor));
      pdf.setDrawColor(...hexToRgb(borderColor));
      pdf.setLineWidth(0.25);
      pdf.roundedRect(cardX, cardY, cardWidth, actualHeight, 2.2, 2.2, "FD");
    }

    let y = cardY + (classic ? 4 : 7);
    if (classic && item.image && item.imageHeight) {
      const imageWidth = Math.min(cardWidth, item.imageHeight * item.image.ratio);
      pdf.addImage(item.image.data, "PNG", cardX, y, imageWidth, item.imageHeight, undefined, "FAST");
      pdf.setDrawColor(...hexToRgb(borderColor));
      pdf.setLineWidth(0.25);
      pdf.rect(cardX, y, imageWidth, item.imageHeight);
      y += item.imageHeight + 2.7;
    }
    addText(item.questionLines, cardX + (classic ? 0 : 6), y, {
      fontSizePt: item.questionFontSize,
      bold: true,
      color: titleColor,
      lineHeightMm: item.questionLineHeight,
    });
    y += item.questionLines.length * item.questionLineHeight + (classic ? 2.7 : 2);

    if (!classic && item.image && item.imageHeight) {
      const imageWidth = Math.min(cardWidth - 12, item.imageHeight * item.image.ratio);
      pdf.addImage(item.image.data, "PNG", cardX + 6, y, imageWidth, item.imageHeight, undefined, "FAST");
      y += item.imageHeight + 4;
    }

    if (item.optionEntries.length) {
      for (const option of item.optionEntries) {
        addText(option.marker, cardX + (classic ? 0 : 7), y, {
          fontSizePt: item.optionFontSize,
          bold: true,
          color: optionMarkerColor,
          lineHeightMm: item.optionLineHeight,
        });
        addText(option.lines, cardX + (classic ? 6.35 : 16), y, {
          fontSizePt: item.optionFontSize,
          bold: false,
          color: optionTextColor,
          lineHeightMm: item.optionLineHeight,
        });
        y += Math.max(1, option.lines.length) * item.optionLineHeight + (classic ? 1.1 : 2);
      }
      if (classic) y += 2.7;
    }

    if (item.answerLines.length) {
      const boxHeight = item.answerLines.length * item.optionLineHeight + 5;
      if (classic) {
        pdf.setDrawColor(...hexToRgb(borderColor));
        pdf.setLineWidth(0.25);
        pdf.setLineDashPattern([1, 1], 0);
        pdf.line(cardX, y + 1, cardX + cardWidth, y + 1);
        pdf.setLineDashPattern([], 0);
      } else {
        pdf.setFillColor(...hexToRgb(answerFill));
        pdf.roundedRect(cardX + 5, y - 1, cardWidth - 10, boxHeight, 1.5, 1.5, "F");
      }
      addText(item.answerLines, cardX + (classic ? 5 : 8), y + (classic ? 6 : 3), {
        fontSizePt: item.answerFontSize,
        bold: true,
        color: answerText,
        lineHeightMm: item.optionLineHeight,
      });
    }
  };

  pageLayouts.forEach((pageLayout, pageIndex) => {
    startPage(pageIndex === 0);
    const availableHeight = bottom - pageLayout.contentTop;
    pageLayout.columns.forEach((columnItems, columnIndex) => {
      if (!columnItems.length) return;
      const totalCardHeight = columnItems.reduce((total, item) => total + item.cardHeight, 0);
      const verticalGap = classic ? 5.3 : columnItems.length > 1
        ? Math.max(5, (availableHeight - totalCardHeight) / (columnItems.length - 1))
        : 0;
      let y = pageLayout.contentTop;
      if (!classic && columnItems.length === 1 && columnItems[0].cardHeight < availableHeight) {
        y += (availableHeight - columnItems[0].cardHeight) / 2;
      }
      columnItems.forEach((item, questionIndex) => {
        drawQuestion(item, questionIndex, pageIndex, columnIndex, y, availableHeight);
        y += item.cardHeight + verticalGap;
      });
    });
  });

  const baseWatermarkImage = await imageFor(settings.watermarkImageUrl, watermarkOpacity * 0.8);
  const watermark = String(settings.watermarkText || "").trim();
  const pageCount = pdf.getNumberOfPages();
  const watermarkPlacement = settings.watermarkPosition || "bottom-right";
  const centered = watermarkPlacement === "center";
  const onLeft = watermarkPlacement.endsWith("left");
  const onTop = watermarkPlacement.startsWith("top");
  const watermarkFontSize = 18 * watermarkScale;
  const watermarkEdge = 20 * 25.4 / 96;
  const maximumWatermarkTextWidth = width - watermarkEdge * 2;
  let watermarkTextImage = watermark && watermarkOpacity > 0
    ? renderWatermarkText({
        text: watermark,
        fontFamily: canvasFontFamily,
        fontSizePt: watermarkFontSize,
        color: "#9ca3af",
        opacity: watermarkOpacity,
        maxWidthMm: maximumWatermarkTextWidth,
      })
    : null;
  let watermarkImage = null;
  if (baseWatermarkImage && watermarkOpacity > 0) {
    const maximumImageHeight = (60 * 25.4 / 96) * watermarkScale;
    const imageWidth = Math.min(width - watermarkEdge * 2, maximumImageHeight * baseWatermarkImage.ratio);
    const imageHeight = imageWidth / Math.max(0.1, baseWatermarkImage.ratio);
    watermarkImage = { data: baseWatermarkImage.data, width: imageWidth, height: imageHeight };
  }

  const watermarkRaster = await composeWatermarkRaster({
    image: watermarkImage,
    text: watermarkTextImage,
    align: centered ? "center" : onLeft ? "left" : "right",
    tilt: watermarkTilt,
  });
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    if (watermarkRaster) {
      const x = centered ? (width - watermarkRaster.width) / 2 : onLeft ? watermarkEdge : width - watermarkEdge - watermarkRaster.width;
      const y = centered ? (height - watermarkRaster.height) / 2 : onTop ? watermarkEdge : height - watermarkEdge - watermarkRaster.height;
      pdf.addImage(watermarkRaster.data, "PNG", x, y, watermarkRaster.width, watermarkRaster.height, undefined, "FAST");
    }

    if (settings.includePageNumbers !== false) {
      pdf.setDrawColor(...hexToRgb(borderColor));
      pdf.setLineWidth(0.25);
      pdf.line(margin, height - 15, width - margin, height - 15);
      addText(`Page ${page} of ${pageCount}`, width - margin, height - 9, {
        fontSizePt: 10,
        bold: false,
        color: textColor,
        align: "right",
        lineHeightMm: 5,
      });
    }
  }

  pdf.save(safeFilename(test.name));
}
