/**
 * src/core/eew/EEWEngine.ts
 * =========================
 * JMA Earthquake Early Warning (EEW) Manager & Alert Evaluator.
 * Predicts ground motion intensity across all 47 prefectures and triggers EEW Warnings.
 */
import { estimateHypocenterAndMagnitude } from './eewInversion';
import { calculateJmaIntensity, isJmaGreaterOrEqual } from '../physics/attenuation';
import { calculateSlabFraction } from '../physics/slabModel';
// Representative centroid coordinates & default ARV amplification for all 47 prefectures of Japan
export const PREFECTURE_CENTROIDS = {
    1: { name: '北海道', lat: 43.064, lon: 141.347, defaultArv: 1.4 },
    2: { name: '青森県', lat: 40.824, lon: 140.740, defaultArv: 1.5 },
    3: { name: '岩手県', lat: 39.704, lon: 141.153, defaultArv: 1.3 },
    4: { name: '宮城県', lat: 38.269, lon: 140.872, defaultArv: 1.6 },
    5: { name: '秋田県', lat: 39.719, lon: 140.103, defaultArv: 1.5 },
    6: { name: '山形県', lat: 38.240, lon: 140.363, defaultArv: 1.4 },
    7: { name: '福島県', lat: 37.750, lon: 140.468, defaultArv: 1.5 },
    8: { name: '茨城県', lat: 36.342, lon: 140.447, defaultArv: 1.8 },
    9: { name: '栃木県', lat: 36.565, lon: 139.884, defaultArv: 1.4 },
    10: { name: '群馬県', lat: 36.391, lon: 139.060, defaultArv: 1.3 },
    11: { name: '埼玉県', lat: 35.857, lon: 139.649, defaultArv: 1.9 },
    12: { name: '千葉県', lat: 35.605, lon: 140.123, defaultArv: 2.0 },
    13: { name: '東京都', lat: 35.689, lon: 139.692, defaultArv: 1.8 },
    14: { name: '神奈川県', lat: 35.448, lon: 139.642, defaultArv: 1.7 },
    15: { name: '新潟県', lat: 37.902, lon: 139.023, defaultArv: 1.6 },
    16: { name: '富山県', lat: 36.695, lon: 137.211, defaultArv: 1.4 },
    17: { name: '石川県', lat: 36.594, lon: 136.626, defaultArv: 1.5 },
    18: { name: '福井県', lat: 36.065, lon: 136.222, defaultArv: 1.4 },
    19: { name: '山梨県', lat: 35.664, lon: 138.568, defaultArv: 1.3 },
    20: { name: '長野県', lat: 36.651, lon: 138.181, defaultArv: 1.3 },
    21: { name: '岐阜県', lat: 35.391, lon: 136.722, defaultArv: 1.5 },
    22: { name: '静岡県', lat: 34.977, lon: 138.383, defaultArv: 1.6 },
    23: { name: '愛知県', lat: 35.180, lon: 136.907, defaultArv: 1.9 },
    24: { name: '三重県', lat: 34.730, lon: 136.509, defaultArv: 1.6 },
    25: { name: '滋賀県', lat: 35.004, lon: 135.869, defaultArv: 1.5 },
    26: { name: '京都府', lat: 35.021, lon: 135.756, defaultArv: 1.6 },
    27: { name: '大阪府', lat: 34.686, lon: 135.520, defaultArv: 1.9 },
    28: { name: '兵庫県', lat: 34.691, lon: 135.183, defaultArv: 1.6 },
    29: { name: '奈良県', lat: 34.685, lon: 135.833, defaultArv: 1.5 },
    30: { name: '和歌山県', lat: 34.226, lon: 135.168, defaultArv: 1.5 },
    31: { name: '鳥取県', lat: 35.504, lon: 134.238, defaultArv: 1.4 },
    32: { name: '島根県', lat: 35.472, lon: 133.051, defaultArv: 1.4 },
    33: { name: '岡山県', lat: 34.662, lon: 133.934, defaultArv: 1.5 },
    34: { name: '広島県', lat: 34.396, lon: 132.459, defaultArv: 1.4 },
    35: { name: '山口県', lat: 34.186, lon: 131.471, defaultArv: 1.4 },
    36: { name: '徳島県', lat: 34.066, lon: 134.559, defaultArv: 1.6 },
    37: { name: '香川県', lat: 34.340, lon: 134.043, defaultArv: 1.5 },
    38: { name: '愛媛県', lat: 33.842, lon: 132.766, defaultArv: 1.5 },
    39: { name: '高知県', lat: 33.559, lon: 133.531, defaultArv: 1.5 },
    40: { name: '福岡県', lat: 33.606, lon: 130.418, defaultArv: 1.6 },
    41: { name: '佐賀県', lat: 33.249, lon: 130.299, defaultArv: 1.6 },
    42: { name: '長崎県', lat: 32.745, lon: 129.874, defaultArv: 1.4 },
    43: { name: '熊本県', lat: 32.790, lon: 130.742, defaultArv: 1.7 },
    44: { name: '大分県', lat: 33.238, lon: 131.613, defaultArv: 1.5 },
    45: { name: '宮崎県', lat: 31.911, lon: 131.424, defaultArv: 1.6 },
    46: { name: '鹿児島県', lat: 31.560, lon: 130.558, defaultArv: 1.6 },
    47: { name: '沖縄県', lat: 26.212, lon: 127.681, defaultArv: 1.5 }
};
export class EEWEngine {
    triggeredObservations = [];
    reportCount = 0;
    latestReport = null;
    isWarningIssued = false;
    lastReportTime = 0;
    stationsSinceLastReport = 0;
    reset() {
        this.triggeredObservations = [];
        this.reportCount = 0;
        this.latestReport = null;
        this.isWarningIssued = false;
    }
    /**
     * Adds newly triggered station observations and evaluates whether to issue an updated EEW report.
     */
    update(newEvents, stationsLats, stationsLons, stationsAmp, currentTime = 0) {
        if (this.latestReport?.isFinal) {
            return null;
        }
        let hasNewPTrigger = false;
        for (const ev of newEvents) {
            if (ev.state === 1) { // P_TRIGGERED
                hasNewPTrigger = true;
                this.triggeredObservations.push({
                    lat: stationsLats[ev.stationIndex],
                    lon: stationsLons[ev.stationIndex],
                    tObs: ev.triggerTime,
                    ampFactor: stationsAmp[ev.stationIndex],
                    measuredPgv: ev.pgvSurface
                });
                this.stationsSinceLastReport++;
            }
        }
        if (!hasNewPTrigger || this.triggeredObservations.length === 0) {
            return null;
        }
        // Rate Limiting: Issue report on 1st detection, then wait at least 3 seconds AND 5+ new stations
        const isFirstReport = this.reportCount === 0;
        const timeSinceLastReport = currentTime - this.lastReportTime;
        const shouldIssueReport = isFirstReport ||
            (this.stationsSinceLastReport >= 5 && timeSinceLastReport >= 3.0);
        if (!shouldIssueReport) {
            return null;
        }
        this.reportCount++;
        this.lastReportTime = currentTime;
        this.stationsSinceLastReport = 0;
        const estHypo = estimateHypocenterAndMagnitude(this.triggeredObservations);
        // Predict ground motion intensity across all 47 prefectures
        const prefectureWarnings = [];
        let maxPredictedIntensity = '0';
        let isWarningAlertNeeded = false;
        for (let code = 1; code <= 47; code++) {
            const pref = PREFECTURE_CENTROIDS[code];
            if (!pref)
                continue;
            const rSlab = calculateSlabFraction(estHypo.lat, estHypo.lon, estHypo.depth, pref.lat, pref.lon);
            const dist = Math.sqrt(Math.pow((pref.lat - estHypo.lat) * 111.0, 2) +
                Math.pow((pref.lon - estHypo.lon) * 111.0 * Math.cos(pref.lat * Math.PI / 180.0), 2) +
                Math.pow(estHypo.depth, 2));
            const { jmaScale } = calculateJmaIntensity(dist, estHypo.depth, estHypo.magnitude, pref.defaultArv, rSlab);
            if (isJmaGreaterOrEqual(jmaScale, maxPredictedIntensity)) {
                maxPredictedIntensity = jmaScale;
            }
            // EEW Warning threshold: predicted intensity >= 4 for alert zones
            const isPrefWarning = isJmaGreaterOrEqual(jmaScale, '4');
            if (isJmaGreaterOrEqual(jmaScale, '5-')) {
                isWarningAlertNeeded = true;
            }
            prefectureWarnings.push({
                prefCode: code,
                prefName: pref.name,
                maxPredictedIntensity: jmaScale,
                isWarning: isPrefWarning
            });
        }
        // Final report condition: 30+ stations or 8+ reports or 60s elapsed
        const isFinal = this.triggeredObservations.length >= 30 || this.reportCount >= 8 || currentTime >= 60.0;
        if (isWarningAlertNeeded) {
            this.isWarningIssued = true;
        }
        const report = {
            reportNumber: this.reportCount,
            isFinal,
            isWarning: isWarningAlertNeeded || this.isWarningIssued,
            estimatedHypocenter: estHypo,
            originTime: estHypo.originTime,
            triggeredStationCount: this.triggeredObservations.length,
            maxPredictedIntensity,
            warnedPrefectures: prefectureWarnings
        };
        this.latestReport = report;
        return report;
    }
    getLatestReport() {
        return this.latestReport;
    }
}
