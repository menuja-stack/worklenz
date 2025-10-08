import express from "express";
import TaskcsvimportController from "../../controllers/task-csv-import-controller";

const router = express.Router();

// Add logging middleware
router.use((req, res, next) => {
    console.log(`CSV Import API Request: ${req.method} ${req.originalUrl}`);
    next();
});

// Required routes
router.get("/:projectId/template", TaskcsvimportController.getTemplateFields);
router.post("/:projectId/validate", TaskcsvimportController.validateData);
router.post("/:projectId/tasks", TaskcsvimportController.create);

export default router;
