/**
 * src/core/simulation/EventSequencer.ts
 * ====================================
 * Manages the chronological sequence of JMA bulletins and milestones.
 * Decouples the simulation clock from the business logic of broadcast reports.
 */
export class EventSequencer {
    milestones = new Map();
    isWarningIssued = false;
    isFlashReportIssued = false;
    isLpgmReportIssued = false;
    isFinalReportIssued = false;
    reset() {
        this.milestones.clear();
        this.isWarningIssued = false;
        this.isFlashReportIssued = false;
        this.isLpgmReportIssued = false;
        this.isFinalReportIssued = false;
    }
    /**
     * Evaluates simulation state and emits new JMA events.
     */
    update(simTime, triggeredCount, eewReport, hypo // Hypocenter from config
    ) {
        // 1. Origin (t=0)
        if (simTime === 0) {
            return this.emitMilestone('ORIGIN', 0, 'Earthquake Occurrence');
        }
        // 2. First Ground Shaking Detected
        if (triggeredCount === 1 && !this.milestones.has('FIRST_TRIGGER')) {
            return this.emitMilestone('FIRST_TRIGGER', simTime, 'Ground Shaking Detected');
        }
        // 3. EEW Forecast logic (handled by EEWEngine primarily, but sequence tracked here)
        if (eewReport && eewReport.reportNumber === 1 && !this.milestones.has('EEW_FORECAST')) {
            return this.emitMilestone('EEW_FORECAST', simTime, 'EEW Forecast #1');
        }
        // 4. EEW Warning (Predicted Intensity >= 5-)
        if (eewReport && eewReport.isWarning && !this.isWarningIssued) {
            this.isWarningIssued = true;
            this.emitMilestone('EEW_WARNING', simTime, 'EEW Warning Issued');
            return {
                event: { type: 'EEW_WARNING_TRIGGERED', payload: eewReport },
                milestone: this.milestones.get('EEW_WARNING')
            };
        }
        // 5. Intensity Flash Report (S-waves settled or significant count)
        // Heuristic: When ~30% of stations have S-arrival or report count is high
        if (triggeredCount > 50 && !this.isFlashReportIssued) {
            this.isFlashReportIssued = true;
            const report = this.generateFlashReport(simTime);
            this.emitMilestone('FLASH_REPORT', simTime, 'Intensity Flash Report');
            return {
                event: { type: 'FLASH_REPORT', payload: report },
                milestone: this.milestones.get('FLASH_REPORT')
            };
        }
        // 6. LPGM Report (Mw >= 6.5 & Depth <= 100km)
        if (hypo.magnitude >= 6.5 && hypo.depth <= 100 && !this.isLpgmReportIssued) {
            this.isLpgmReportIssued = true;
            const report = this.generateLpgmReport(simTime, hypo);
            this.emitMilestone('LPGM_REPORT', simTime, 'Long-Period Ground Motion Report');
            return {
                event: { type: 'LPGM_REPORT', payload: report },
                milestone: this.milestones.get('LPGM_REPORT')
            };
        }
        // 7. Final Report
        if (eewReport && eewReport.isFinal && !this.isFinalReportIssued) {
            this.isFinalReportIssued = true;
            this.emitMilestone('FINAL_REPORT', simTime, 'Detailed Earthquake Information');
            return {
                event: { type: 'FINAL_REPORT', payload: eewReport },
                milestone: this.milestones.get('FINAL_REPORT')
            };
        }
        return {};
    }
    emitMilestone(type, time, label) {
        const milestone = { type, time, label };
        this.milestones.set(type, milestone);
        return { milestone };
    }
    generateFlashReport(time) {
        return {
            issuedTime: time,
            intensities: {
                '5-': ['岩手県', '宮城県'],
                '4': ['青森県', '秋田県'],
                '3': ['山形県', '福島県'],
            },
            summary: 'Observed intensities are arriving. Max intensity 5- detected.'
        };
    }
    generateLpgmReport(time, hypo) {
        return {
            issuedTime: time,
            affectedPrefectures: [
                { prefCode: 13, prefName: '東京都', classLevel: 2 },
                { prefCode: 14, prefName: '神奈川県', classLevel: 1 },
            ]
        };
    }
    getMilestones() {
        return Array.from(this.milestones.values()).sort((a, b) => a.time - b.time);
    }
}
