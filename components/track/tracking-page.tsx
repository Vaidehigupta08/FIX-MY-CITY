"use client"

import type React from "react"
import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Search, MapPin, Phone, Upload, ThumbsUp } from "lucide-react"
import { ComplaintDetails } from "./complaint-details"
import { StatusTimeline } from "./status-timeline"
import { useAuth } from "@/components/auth-context"
import { findLocalReportForUser, upsertLocalReport } from "@/lib/client-persistence"
import { getComplaintLocationLabel } from "@/lib/report-display"
import type { ComplaintRecord } from "@/lib/types"

export function TrackingPage() {
  const searchParams = useSearchParams()
  const { user, isLoading: isAuthLoading } = useAuth()
  const [ticketId, setTicketId] = useState(searchParams.get("id") || "")
  const [searchSubmitted, setSearchSubmitted] = useState(!!searchParams.get("id"))
  const [complaint, setComplaint] = useState<ComplaintRecord | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchComplaint = async (nextTicketId: string) => {
    if (!user) return

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/reports/${encodeURIComponent(nextTicketId)}?userEmail=${encodeURIComponent(user.email)}&role=${user.role}`,
        { cache: "no-store" },
      )
      const data = await response.json()

      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || "Complaint not found.")
      }

      if (data.report) {
        upsertLocalReport(data.report)
      }
      setComplaint(data.report ?? null)
      setSearchSubmitted(true)
    } catch (err) {
      const localComplaint = findLocalReportForUser(nextTicketId, user.email, user.role)
      setComplaint(localComplaint)
      setSearchSubmitted(true)
      setError(localComplaint ? null : err instanceof Error ? err.message : "Complaint not found.")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    const initialTicketId = searchParams.get("id")

    if (initialTicketId && user) {
      fetchComplaint(initialTicketId)
    }
  }, [searchParams, user])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (ticketId.trim()) {
      await fetchComplaint(ticketId.trim())
    }
  }

  if (isAuthLoading) {
    return <div className="py-12 text-center text-muted-foreground">Loading your complaints...</div>
  }

  if (!searchSubmitted) {
    return (
      <div className="min-h-[calc(100vh-8rem)] bg-gradient-to-br from-background to-secondary flex items-center justify-center py-12">
        <div className="max-w-2xl mx-auto px-4 w-full">
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">Track Your Complaint</h1>
            <p className="text-lg text-muted-foreground">Enter your ticket ID to check the status of your report</p>
          </div>

          <form onSubmit={handleSearch} className="space-y-6">
            <div className="relative">
              <input
                type="text"
                value={ticketId}
                onChange={(e) => setTicketId(e.target.value)}
                placeholder="Enter Ticket ID (e.g., FIXC123456)"
                className="w-full px-6 py-4 rounded-lg bg-card border-2 border-border focus:outline-none focus:border-primary text-lg"
              />
              <Search className="absolute right-4 top-4 w-6 h-6 text-muted-foreground" />
            </div>

            <button
              type="submit"
              className="w-full px-6 py-4 rounded-lg bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-all text-lg"
            >
              Search
            </button>
          </form>

          <div className="mt-12 text-center text-muted-foreground">
            <p className="text-sm mb-4">Need help finding your ticket ID?</p>
            <p className="text-sm">
              Use the ticket ID from your successful report submission screen.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!complaint) {
    return (
      <div className="min-h-[calc(100vh-8rem)] bg-gradient-to-br from-background to-secondary flex items-center justify-center py-12">
        <div className="max-w-2xl mx-auto px-4 w-full text-center">
          <h1 className="text-2xl font-bold mb-2">{isLoading ? "Searching..." : "Complaint not found"}</h1>
          <p className="text-muted-foreground mb-6">
            {isLoading
              ? "Please wait while we look up your complaint in the database."
              : error || "The ticket ID you entered could not be found. Please check and try again."}
          </p>
          <button
            onClick={() => {
              setSearchSubmitted(false)
              setError(null)
            }}
            className="px-6 py-3 rounded-lg bg-primary text-primary-foreground font-semibold hover:opacity-90"
          >
            {isLoading ? "Searching..." : "Try Again"}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-8rem)] bg-gradient-to-br from-background to-secondary py-12">
      <div className="max-w-4xl mx-auto px-4 w-full">
        <button
          onClick={() => setSearchSubmitted(false)}
          className="mb-8 text-primary hover:underline font-semibold flex items-center gap-2"
        >
          Search another complaint
        </button>

        <div className="bg-card rounded-2xl p-8 border border-border mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Ticket ID</p>
              <p className="text-3xl font-bold font-mono text-primary">{complaint.ticketId}</p>
            </div>

            <div className="flex items-center gap-2">
              <span
                className={`px-4 py-2 rounded-full font-semibold text-sm ${
                  complaint.status === "Submitted"
                    ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200"
                    : complaint.status === "Assigned"
                      ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200"
                      : complaint.status === "In Progress"
                        ? "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200"
                        : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200"
                }`}
              >
                {complaint.status}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground mb-1">Created</p>
              <p className="font-semibold">{new Date(complaint.createdAt).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Updated</p>
              <p className="font-semibold">{new Date(complaint.updatedAt).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Upvotes</p>
              <p className="font-semibold flex items-center gap-1">
                <ThumbsUp className="w-4 h-4" /> {complaint.upvotes}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Urgency</p>
              <p
                className={`font-semibold px-2 py-1 rounded inline-block text-xs ${
                  complaint.urgency === "High"
                    ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200"
                    : complaint.urgency === "Medium"
                      ? "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200"
                      : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200"
                }`}
              >
                {complaint.urgency}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <ComplaintDetails complaint={complaint} />
            <StatusTimeline timeline={complaint.timeline} />
          </div>

          <div className="space-y-6">
            <div className="bg-card rounded-xl p-6 border border-border">
              <h3 className="font-semibold mb-4">Assigned To</h3>
              <p className="text-sm text-muted-foreground mb-4">{complaint.assignedDepartment}</p>

              <div className="space-y-3 pt-4 border-t border-border">
                <div>
                  <p className="text-sm font-medium mb-1">{complaint.officer.name}</p>
                  <p className="text-xs text-muted-foreground">{complaint.officer.role}</p>
                </div>

                <a
                  href={`tel:${complaint.officer.phone}`}
                  className="inline-flex items-center gap-2 text-sm text-primary hover:underline font-semibold"
                >
                  <Phone className="w-4 h-4" />
                  {complaint.officer.phone}
                </a>
              </div>
            </div>

            <div className="bg-card rounded-xl p-6 border border-border">
              <h3 className="font-semibold mb-4">Actions</h3>
              <div className="space-y-3">
                <button className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-secondary text-secondary-foreground font-semibold hover:opacity-90 transition-colors text-sm">
                  <Upload className="w-4 h-4" />
                  Add Follow-up Photo
                </button>

                <button className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-border text-foreground font-semibold hover:bg-muted transition-colors text-sm">
                  Contact Assigned Officer
                </button>

                <button className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-border text-foreground font-semibold hover:bg-muted transition-colors text-sm">
                  Subscribe to Updates
                </button>
              </div>
            </div>

            <div className="bg-card rounded-xl p-6 border border-border">
              <h3 className="font-semibold mb-4">Location</h3>
              <div className="w-full h-48 bg-gradient-to-br from-primary/10 to-accent/10 rounded-lg flex items-center justify-center border border-border">
                <MapPin className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground mt-3">
                {getComplaintLocationLabel(complaint)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
