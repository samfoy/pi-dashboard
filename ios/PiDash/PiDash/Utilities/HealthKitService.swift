import Foundation
import HealthKit

// MARK: - HealthKitService

final class HealthKitService {

    static let shared = HealthKitService()
    private let store = HKHealthStore()

    private var readTypes: Set<HKObjectType> {
        var types = Set<HKObjectType>()
        if let steps   = HKObjectType.quantityType(forIdentifier: .stepCount)          { types.insert(steps) }
        if let rhr     = HKObjectType.quantityType(forIdentifier: .restingHeartRate)   { types.insert(rhr) }
        if let active  = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) { types.insert(active) }
        if let sleep   = HKObjectType.categoryType(forIdentifier: .sleepAnalysis)      { types.insert(sleep) }
        types.insert(HKObjectType.workoutType())
        return types
    }

    // MARK: - Authorization

    func requestAuthorization() async throws {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitError.notAvailable
        }
        try await store.requestAuthorization(toShare: [], read: readTypes)
    }

    // MARK: - Summary

    func fetchTodaySummary() async -> String {
        guard HKHealthStore.isHealthDataAvailable() else {
            return "[Health Summary — Unavailable on this device]\n\n"
        }

        async let steps          = fetchSteps()
        async let sleep          = fetchSleep()
        async let restingHR      = fetchRestingHR()
        async let activeCalories = fetchActiveCalories()
        async let workoutCount   = fetchWorkoutCount()

        let (s, sl, hr, ac, wc) = await (steps, sleep, restingHR, activeCalories, workoutCount)

        let parts: [String] = [
            "Steps: \(s.map { "\($0)" } ?? "—")",
            "Sleep: \(sl ?? "—")",
            "Resting HR: \(hr.map { "\($0) bpm" } ?? "—")",
            "Active Calories: \(ac.map { "\(Int($0.rounded())) kcal" } ?? "—")",
            "Workouts: \(wc.map { "\($0)" } ?? "—")"
        ]
        return "[Health Summary — Today] " + parts.joined(separator: " | ") + "\n\n"
    }

    // MARK: - Private fetch helpers

    private func fetchSteps() async -> Int? {
        guard let type = HKQuantityType.quantityType(forIdentifier: .stepCount) else { return nil }
        let now   = Date()
        let start = Calendar.current.startOfDay(for: now)
        let pred  = HKQuery.predicateForSamples(withStart: start, end: now, options: .strictStartDate)
        return await withCheckedContinuation { cont in
            let q = HKStatisticsQuery(
                quantityType: type,
                quantitySamplePredicate: pred,
                options: .cumulativeSum
            ) { _, stats, _ in
                let v = stats?.sumQuantity()?.doubleValue(for: .count())
                cont.resume(returning: v.map { Int($0) })
            }
            store.execute(q)
        }
    }

    private func fetchActiveCalories() async -> Double? {
        guard let type = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) else { return nil }
        let now   = Date()
        let start = Calendar.current.startOfDay(for: now)
        let pred  = HKQuery.predicateForSamples(withStart: start, end: now, options: .strictStartDate)
        return await withCheckedContinuation { cont in
            let q = HKStatisticsQuery(
                quantityType: type,
                quantitySamplePredicate: pred,
                options: .cumulativeSum
            ) { _, stats, _ in
                cont.resume(returning: stats?.sumQuantity()?.doubleValue(for: .kilocalorie()))
            }
            store.execute(q)
        }
    }

    private func fetchRestingHR() async -> Int? {
        guard let type = HKQuantityType.quantityType(forIdentifier: .restingHeartRate) else { return nil }
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
        return await withCheckedContinuation { cont in
            let q = HKSampleQuery(
                sampleType: type,
                predicate: nil,
                limit: 1,
                sortDescriptors: [sort]
            ) { _, samples, _ in
                guard let sample = samples?.first as? HKQuantitySample else {
                    cont.resume(returning: nil); return
                }
                let bpm = sample.quantity.doubleValue(for: HKUnit(from: "count/min"))
                cont.resume(returning: Int(bpm))
            }
            store.execute(q)
        }
    }

    private func fetchSleep() async -> String? {
        guard let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else { return nil }
        let cal = Calendar.current
        let now = Date()
        // yesterday 18:00 → today 12:00 — captures a full overnight window
        guard
            let yesterday6pm = cal.date(byAdding: .hour, value: -18, to: cal.startOfDay(for: now)),
            let todayNoon    = cal.date(bySettingHour: 12, minute: 0, second: 0, of: now)
        else { return nil }
        let pred = HKQuery.predicateForSamples(
            withStart: yesterday6pm, end: todayNoon, options: .strictStartDate
        )
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        return await withCheckedContinuation { cont in
            let q = HKSampleQuery(
                sampleType: type,
                predicate: pred,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [sort]
            ) { _, samples, _ in
                guard let samples = samples as? [HKCategorySample] else {
                    cont.resume(returning: nil); return
                }
                let asleepValues: Set<Int> = [
                    HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
                    HKCategoryValueSleepAnalysis.asleepCore.rawValue,
                    HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
                    HKCategoryValueSleepAnalysis.asleepREM.rawValue
                ]
                let total = samples
                    .filter { asleepValues.contains($0.value) }
                    .reduce(0.0) { $0 + $1.endDate.timeIntervalSince($1.startDate) }
                guard total >= 60 else { cont.resume(returning: nil); return }
                let h = Int(total) / 3600
                let m = (Int(total) % 3600) / 60
                cont.resume(returning: "\(h)h \(m)m")
            }
            store.execute(q)
        }
    }

    private func fetchWorkoutCount() async -> Int? {
        let now   = Date()
        let start = Calendar.current.startOfDay(for: now)
        let pred  = HKQuery.predicateForSamples(withStart: start, end: now, options: .strictStartDate)
        let sort  = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
        return await withCheckedContinuation { cont in
            let q = HKSampleQuery(
                sampleType: HKObjectType.workoutType(),
                predicate: pred,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [sort]
            ) { _, samples, _ in
                cont.resume(returning: samples?.count)
            }
            store.execute(q)
        }
    }
}

// MARK: - HealthKitError

enum HealthKitError: Error {
    case notAvailable
}
