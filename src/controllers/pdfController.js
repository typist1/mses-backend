import mammoth from "mammoth";
import multer from "multer";
import { extractText as extractPDFText } from "unpdf";
import { scrapeJobPage } from "../scrape.js";
import libre from "libreoffice-convert";
import { promisify } from "util";

const libreConvert = promisify(libre.convert);

const upload = multer({ storage: multer.memoryStorage() });

const pdfController = {
    upload,

    async extractJobDescription(req, res) {
        try {
            const { url } = req.body;

            if (!url) {
                return res.status(400).json({ error: "No URL provided" });
            }

            const result = await scrapeJobPage(url);

            if (!result.success) {
                return res.status(500).json({
                    error: "Could not scrape job description",
                });
            }

            res.json({
                text: result.text,
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({
                error: "Server error while scraping",
            });
        }
    },

    async extractText(req, res) {
        try {
            const file = req.file;

            if (!file) {
                return res.status(400).json({ error: "No file uploaded" });
            }

            let extractedText = "";

            if (file.mimetype === "application/pdf") {
                const uint8Array = new Uint8Array(file.buffer);
                const { text } = await extractPDFText(uint8Array, { mergePages: true });
                extractedText = text;
            } else if (file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
                const result = await mammoth.extractRawText({ buffer: file.buffer });
                extractedText = result.value;
            } else {
                return res.status(400).json({ error: "Unsupported file type" });
            }

            res.json({ text: extractedText });
        } catch (err) {
            console.error("Error extracting text:", err.message);
            res.status(500).json({ error: "Failed to extract text", details: err.message });
        }
    },

    async convertToPdf(req, res) {
        try {
            const file = req.file;
            if (!file) return res.status(400).json({ error: "No file uploaded" });

            const pdfBuffer = await libreConvert(file.buffer, ".pdf", undefined);
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename="resume.pdf"`);
            res.send(pdfBuffer);
        } catch (err) {
            console.error("PDF conversion error:", err.message);
            res.status(500).json({ error: "Failed to convert to PDF", details: err.message });
        }
    },
};

export default pdfController;