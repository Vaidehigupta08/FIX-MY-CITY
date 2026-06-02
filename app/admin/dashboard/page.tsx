"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-context";
import {
  getLocalReports,
  mergeAndStoreReports,
  updateLocalReportStatus,
  upsertLocalReport,
} from "@/lib/client-persistence";
import { getComplaintArea } from "@/lib/report-display";
import type { ComplaintRecord } from "@/lib/types";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Filter,
  Loader2,
  MapPin,
  MoreHorizontal,
  Search,
} from "lucide-react";

type DashboardStatus = "Submitted" | "Assigned" | "In Progress" | "Resolved";

const statusColors: Record<DashboardStatus, string> = {
  Submitted:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:border-amber-500/60",
  Assigned:
    "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-200 dark:border-indigo-500/60",
  "In Progress":
    "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-200 dark:border-sky-500/60",
  Resolved:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:border-emerald-500/60",
};

function formatDateParts(isoDate: string) {
  const date = new Date(isoDate);

  return {
    date: new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date),
    time: new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date),
  };
}

export default function AdminDashboardPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [complaints, setComplaints] = useState<ComplaintRecord[]>([]);
  const [draftStatuses, setDraftStatuses] = useState<Record<string, DashboardStatus>>({});
  const [statusFilter, setStatusFilter] = useState<DashboardStatus | "All">("All");
  const [cityFilter, setCityFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [isFetchingComplaints, setIsFetchingComplaints] = useState(true);
  const [updatingTicketId, setUpdatingTicketId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      router.push("/login");
      return;
    }

    if (user.role !== "admin") {
      router.push("/");
    }
  }, [isLoading, router, user]);

  useEffect(() => {
    let active = true;

    const loadComplaints = async () => {
      if (!user || user.role !== "admin") return;

      try {
        setIsFetchingComplaints(true);
        setError(null);

        const response = await fetch("/api/reports", { cache: "no-store" });
        const data = await response.json();

        if (!response.ok || data?.success === false) {
          throw new Error(data?.error || "Failed to load complaints.");
        }

        if (!active) return;

        const reports = mergeAndStoreReports(
          Array.isArray(data.reports) ? (data.reports as ComplaintRecord[]) : [],
        );
        const visibleReports = user.department
          ? reports.filter((report) => report.assignedDepartment === user.department)
          : reports;

        setComplaints(visibleReports);
        setDraftStatuses(
          Object.fromEntries(
            visibleReports.map((report) => [report.ticketId, report.status as DashboardStatus]),
          ),
        );
      } catch (err) {
        if (!active) return;

        const reports = getLocalReports();
        const visibleReports = user.department
          ? reports.filter((report) => report.assignedDepartment === user.department)
          : reports;

        setComplaints(visibleReports);
        setDraftStatuses(
          Object.fromEntries(
            visibleReports.map((report) => [report.ticketId, report.status as DashboardStatus]),
          ),
        );
        if (visibleReports.length === 0) {
          setError(err instanceof Error ? err.message : "Failed to load complaints.");
        }
      } finally {
        if (active) {
          setIsFetchingComplaints(false);
        }
      }
    };

    loadComplaints();

    return () => {
      active = false;
    };
  }, [user]);

  const cities = useMemo(
    () => Array.from(new Set(complaints.map((complaint) => complaint.city))),
    [complaints],
  );

  const stats = useMemo(() => {
    const total = complaints.length;
    const submitted = complaints.filter((complaint) => complaint.status === "Submitted").length;
    const assigned = complaints.filter((complaint) => complaint.status === "Assigned").length;
    const inProgress = complaints.filter(
      (complaint) => complaint.status === "In Progress",
    ).length;
    const resolved = complaints.filter((complaint) => complaint.status === "Resolved").length;

    return { total, submitted, assigned, inProgress, resolved };
  }, [complaints]);

  const filteredComplaints = useMemo(() => {
    return complaints.filter((complaint) => {
      if (statusFilter !== "All" && complaint.status !== statusFilter) return false;
      if (cityFilter !== "All" && complaint.city !== cityFilter) return false;

      if (!search) return true;

      const searchableFields = [
        complaint.ticketId,
        complaint.category,
        getComplaintArea(complaint),
        complaint.city,
      ]
        .join(" ")
        .toLowerCase();

      return searchableFields.includes(search.toLowerCase());
    });
  }, [cityFilter, complaints, search, statusFilter]);

  const recentComplaints = useMemo(() => complaints.slice(0, 3), [complaints]);

  const handleStatusUpdate = async (ticketId: string) => {
    if (!user?.department) return;

    const selectedStatus = draftStatuses[ticketId];

    try {
      setUpdatingTicketId(ticketId);
      setError(null);

      const response = await fetch(`/api/reports/${encodeURIComponent(ticketId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-status",
          status: selectedStatus,
          adminDepartment: user.department,
        }),
      });
      const data = await response.json();

      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || "Failed to update complaint status.");
      }

      const updatedComplaint = data.report as ComplaintRecord;
      upsertLocalReport(updatedComplaint);
      setComplaints((currentComplaints) =>
        currentComplaints.map((complaint) =>
          complaint.ticketId === updatedComplaint.ticketId ? updatedComplaint : complaint,
        ),
      );
      setDraftStatuses((currentDrafts) => ({
        ...currentDrafts,
        [ticketId]: updatedComplaint.status as DashboardStatus,
      }));
    } catch (err) {
      try {
        const updatedComplaint = updateLocalReportStatus(ticketId, selectedStatus);
        setComplaints((currentComplaints) =>
          currentComplaints.map((complaint) =>
            complaint.ticketId === updatedComplaint.ticketId ? updatedComplaint : complaint,
          ),
        );
      } catch {
        setError(err instanceof Error ? err.message : "Failed to update complaint status.");
      }
    } finally {
      setUpdatingTicketId(null);
    }
  };

  if (isLoading || isFetchingComplaints || !user || user.role !== "admin") {
    return (
      <main className="min-h-[80vh] flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading admin dashboard...</span>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[80vh] px-4 py-8 flex justify-center bg-slate-50 dark:bg-slate-950">
      <div className="w-full max-w-6xl space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
              Admin Dashboard
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Monitor {user.department ?? "city"} issues, track resolution status and manage
              high-priority cases.
            </p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {user.department ? `Department: ${user.department}` : "All departments access"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs sm:text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 transition-colors dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800">
              <Filter className="mr-2 h-4 w-4" />
              Export CSV
            </button>
            <button
              onClick={() => router.push("/report")}
              className="inline-flex items-center rounded-full bg-blue-600 px-4 py-2 text-xs sm:text-sm font-medium text-white shadow-md hover:bg-blue-500 transition-colors"
            >
              <AlertTriangle className="mr-2 h-4 w-4" />
              New Complaint
            </button>
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:bg-slate-900 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                Total Complaints
              </p>
              <MapPin className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <p className="mt-3 text-3xl font-semibold text-slate-900 dark:text-slate-50">
              {stats.total}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Across {cities.length} cities
            </p>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm dark:bg-amber-500/10 dark:border-amber-500/40">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-amber-700 uppercase tracking-wide dark:text-amber-200">
                Submitted
              </p>
              <AlertTriangle className="h-5 w-5 text-amber-500 dark:text-amber-300" />
            </div>
            <p className="mt-3 text-3xl font-semibold text-amber-800 dark:text-amber-100">
              {stats.submitted}
            </p>
            <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-200/80">
              Need assignment or action
            </p>
          </div>

          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 shadow-sm dark:bg-sky-500/10 dark:border-sky-500/40">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-sky-700 uppercase tracking-wide dark:text-sky-200">
                Active Work
              </p>
              <Clock className="h-5 w-5 text-sky-500 dark:text-sky-300" />
            </div>
            <p className="mt-3 text-3xl font-semibold text-sky-800 dark:text-sky-100">
              {stats.assigned + stats.inProgress}
            </p>
            <p className="mt-1 text-xs text-sky-700/80 dark:text-sky-200/80">
              Assigned and in progress
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm dark:bg-emerald-500/10 dark:border-emerald-500/40">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-emerald-700 uppercase tracking-wide dark:text-emerald-200">
                Resolved
              </p>
              <CheckCircle2 className="h-5 w-5 text-emerald-500 dark:text-emerald-300" />
            </div>
            <p className="mt-3 text-3xl font-semibold text-emerald-800 dark:text-emerald-100">
              {stats.resolved}
            </p>
            <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-200/80">
              Successfully closed issues
            </p>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:bg-slate-900 dark:border-slate-800">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  Complaints Overview
                </h2>

                <div className="flex flex-wrap gap-2">
                  {(["All", "Submitted", "Assigned", "In Progress", "Resolved"] as const).map(
                    (status) => (
                      <button
                        key={status}
                        onClick={() =>
                          setStatusFilter(
                            status === "All" ? "All" : (status as DashboardStatus),
                          )
                        }
                        className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                          statusFilter === status
                            ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        }`}
                      >
                        {status}
                      </button>
                    ),
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by ticket ID, address, category..."
                    className="w-full rounded-full border border-slate-200 bg-slate-50 pl-9 pr-3 py-2 text-xs sm:text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                  />
                </div>

                <select
                  value={cityFilter}
                  onChange={(e) => setCityFilter(e.target.value)}
                  className="w-full sm:w-40 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs sm:text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                >
                  <option value="All">All Cities</option>
                  {cities.map((city) => (
                    <option key={city} value={city}>
                      {city}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm dark:bg-slate-900 dark:border-slate-800">
              <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between dark:border-slate-800">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  Latest Complaints
                </h3>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Showing {filteredComplaints.length} of {complaints.length}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 dark:bg-slate-900/80 dark:text-slate-400 dark:border-slate-800">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">ID</th>
                      <th className="px-4 py-2 text-left font-medium">Category</th>
                      <th className="px-4 py-2 text-left font-medium">Area</th>
                      <th className="px-4 py-2 text-left font-medium">City</th>
                      <th className="px-4 py-2 text-left font-medium">Status</th>
                      <th className="px-4 py-2 text-left font-medium">Priority</th>
                      <th className="px-4 py-2 text-left font-medium">Date &amp; Time</th>
                      <th className="px-4 py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredComplaints.map((complaint, idx) => {
                      const dateParts = formatDateParts(complaint.createdAt);

                      return (
                        <tr
                          key={complaint.ticketId}
                          className={`border-t border-slate-100 dark:border-slate-800 ${
                            idx % 2 === 0
                              ? "bg-white dark:bg-slate-900"
                              : "bg-slate-50/70 dark:bg-slate-900/80"
                          } hover:bg-blue-50/60 dark:hover:bg-slate-800/80 transition-colors`}
                        >
                          <td className="px-4 py-2 align-top text-slate-900 dark:text-slate-50 font-mono">
                            {complaint.ticketId}
                          </td>
                          <td className="px-4 py-2 align-top text-slate-800 dark:text-slate-100">
                            {complaint.category}
                          </td>
                          <td className="px-4 py-2 align-top text-slate-800 dark:text-slate-100">
                            {getComplaintArea(complaint)}
                          </td>
                          <td className="px-4 py-2 align-top text-slate-800 dark:text-slate-100">
                            {complaint.city}
                          </td>
                          <td className="px-4 py-2 align-top">
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusColors[complaint.status]}`}
                            >
                              {complaint.status}
                            </span>
                          </td>
                          <td className="px-4 py-2 align-top">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border ${
                                complaint.urgency === "High"
                                  ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-200 dark:border-red-500/50"
                                  : complaint.urgency === "Medium"
                                    ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:border-amber-500/50"
                                    : "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-500/10 dark:text-slate-200 dark:border-slate-500/50"
                              }`}
                            >
                              {complaint.urgency}
                            </span>
                          </td>
                          <td className="px-4 py-2 align-top text-slate-800 dark:text-slate-100">
                            <div className="flex flex-col">
                              <span>{dateParts.date}</span>
                              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                                {dateParts.time}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2 align-top text-right">
                            <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center sm:justify-end">
                              <select
                                value={draftStatuses[complaint.ticketId] ?? complaint.status}
                                onChange={(event) =>
                                  setDraftStatuses((currentDrafts) => ({
                                    ...currentDrafts,
                                    [complaint.ticketId]: event.target.value as DashboardStatus,
                                  }))
                                }
                                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                              >
                                <option value="Submitted">Submitted</option>
                                <option value="Assigned">Assigned</option>
                                <option value="In Progress">In Progress</option>
                                <option value="Resolved">Resolved</option>
                              </select>
                              <button
                                onClick={() => void handleStatusUpdate(complaint.ticketId)}
                                disabled={
                                  updatingTicketId === complaint.ticketId ||
                                  (draftStatuses[complaint.ticketId] ?? complaint.status) ===
                                    complaint.status
                                }
                                className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-600 hover:bg-slate-50 shadow-sm disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                              >
                                <MoreHorizontal className="h-3 w-3" />
                                <span className="ml-1 hidden sm:inline">
                                  {updatingTicketId === complaint.ticketId ? "Saving..." : "Update"}
                                </span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    {filteredComplaints.length === 0 && (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-4 py-6 text-center text-xs text-slate-500 dark:text-slate-400"
                        >
                          No complaints found for selected filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:bg-slate-900 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50 mb-2">
                City-wise Breakdown
              </h2>

              <div className="space-y-3">
                {cities.map((city) => {
                  const total = complaints.filter((complaint) => complaint.city === city).length;
                  const resolved = complaints.filter(
                    (complaint) =>
                      complaint.city === city && complaint.status === "Resolved",
                  ).length;
                  const percent = total === 0 ? 0 : Math.round((resolved / total) * 100);

                  return (
                    <div
                      key={city}
                      className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-1 dark:bg-slate-900 dark:border-slate-800"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-900 dark:text-slate-50">
                          {city}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400">
                          {resolved}/{total} resolved
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden dark:bg-slate-800">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {percent}% resolution rate
                      </p>
                    </div>
                  );
                })}

                {cities.length === 0 && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    No department complaints yet.
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:bg-slate-900 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50 mb-2">
                Recent Activity
              </h2>

              <ul className="space-y-3 text-xs">
                {recentComplaints.map((complaint) => {
                  const icon =
                    complaint.status === "Resolved" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-300" />
                    ) : complaint.status === "Assigned" ||
                      complaint.status === "In Progress" ? (
                      <Clock className="h-3.5 w-3.5 text-sky-500 dark:text-sky-300" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 dark:text-amber-300" />
                    );

                  const iconBackground =
                    complaint.status === "Resolved"
                      ? "bg-emerald-50 dark:bg-emerald-500/15"
                      : complaint.status === "Assigned" ||
                          complaint.status === "In Progress"
                        ? "bg-sky-50 dark:bg-sky-500/15"
                        : "bg-amber-50 dark:bg-amber-500/15";

                  return (
                    <li key={complaint.ticketId} className="flex gap-3">
                      <div
                        className={`mt-0.5 h-6 w-6 rounded-full flex items-center justify-center ${iconBackground}`}
                      >
                        {icon}
                      </div>
                      <div>
                        <p className="text-slate-900 dark:text-slate-100">
                          Complaint <span className="font-mono">{complaint.ticketId}</span> is{" "}
                          <span className="font-medium">{complaint.status}</span>.
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {getComplaintArea(complaint)} • {complaint.city}
                        </p>
                      </div>
                    </li>
                  );
                })}

                {recentComplaints.length === 0 && (
                  <li className="text-slate-500 dark:text-slate-400">
                    No complaints are assigned to this department yet.
                  </li>
                )}
              </ul>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
