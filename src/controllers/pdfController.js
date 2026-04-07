import mammoth from "mammoth";
import multer from "multer";
import { extractText as extractPDFText } from "unpdf";
import { scrapeJobPage } from "../scrape.js";

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
                //console.log("return failed")
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
        console.log("req.file:", req.file);

        try {
            const file = req.file;

            if (!file) {
                console.log("ERROR: No file in request");
                return res.status(400).json({ error: "No file uploaded" });
            }

            console.log("File details:", {
                originalname: file.originalname,
                mimetype: file.mimetype,
                size: file.size
            });

            let extractedText = "";

            if (file.mimetype === "application/pdf") {
                console.log("Processing PDF...");
                const uint8Array = new Uint8Array(file.buffer);
                const { text } = await extractPDFText(uint8Array);
                extractedText = text;
                console.log("PDF text extracted, length:", extractedText.length);

            } else if (file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
                console.log("Processing DOCX...");
                const result = await mammoth.extractRawText({
                    buffer: file.buffer,
                });
                extractedText = result.value;
                console.log("DOCX text extracted, length:", extractedText.length);
            } else {
                console.log("ERROR: Unsupported file type:", file.mimetype);
                return res.status(400).json({ error: "Unsupported file type" });
            }

            console.log("Sending success response");
            res.json({ text: extractedText });
        } catch (err) {
            console.error("CATCH ERROR:", err);
            console.error("Stack:", err.stack);
            res.status(500).json({ error: "Failed to extract text", details: err.message });
        }
    }
};

export default pdfController;