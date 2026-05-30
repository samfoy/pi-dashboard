import Foundation

// MARK: - APIClient + Workflows

extension APIClient {

    /// `GET /api/workflows/runs` → list of all run summaries
    func fetchWorkflowRuns() async throws -> [WorkflowRun] {
        let url = try requireURL(path: "/workflows/runs")
        let data = try await get(url: url)
        do {
            let response = try decoder.decode(WorkflowRunsResponse.self, from: data)
            return response.runs
        } catch {
            throw APIError.decodingError(error)
        }
    }

    /// `GET /api/workflows/runs/:id` → full run detail with timeline
    func fetchWorkflowRunDetail(runId: String) async throws -> WorkflowRunDetail {
        let url = try requireURL(path: "/workflows/runs/\(runId)")
        let data = try await get(url: url)
        do {
            return try decoder.decode(WorkflowRunDetail.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    /// `DELETE /api/workflows/runs/:id`
    func deleteWorkflowRun(runId: String) async throws {
        let url = try requireURL(path: "/workflows/runs/\(runId)")
        try await delete(url: url)
    }

    /// `GET /api/workflows/scripts` → discovered workflow scripts
    func fetchWorkflowScripts() async throws -> [WorkflowScript] {
        let url = try requireURL(path: "/workflows/scripts")
        let data = try await get(url: url)
        do {
            let response = try decoder.decode(WorkflowScriptsResponse.self, from: data)
            return response.scripts
        } catch {
            throw APIError.decodingError(error)
        }
    }

    // NOTE: Private helpers `get`, `delete`, `requireURL`, and `decoder`
    // are defined on the main APIClient actor body.
}
