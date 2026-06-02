"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { useTheme } from "@/lib/theme-provider"
import { Search, MapPin, ThumbsUp, MessageCircle } from "lucide-react"
import { useAuth } from "@/components/auth-context"
import { getCommunityActorId, UPVOTED_STORAGE_KEY } from "@/lib/community-engagement"
import {
  getLocalReports,
  mergeAndStoreReports,
  toggleLocalReportUpvote,
  upsertLocalReport,
} from "@/lib/client-persistence"
import { getComplaintArea, getComplaintLocationLabel } from "@/lib/report-display"
import type { ComplaintRecord } from "@/lib/types"

type FilterType = "near" | "trending" | "urgent" | "latest"

export function CommunityPage() {
  const { language } = useTheme()
  const { profile, user } = useAuth()
  const [activeFilter, setActiveFilter] = useState<FilterType>("trending")
  const [searchTerm, setSearchTerm] = useState("")
  const [issues, setIssues] = useState<ComplaintRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [upvotedIssues, setUpvotedIssues] = useState<string[]>([])
  const [actorId, setActorId] = useState("")
  const [pendingUpvoteTicketId, setPendingUpvoteTicketId] = useState<string | null>(null)

  const filters: Array<{ id: FilterType; label: string; icon: ReactNode }> = [
    { id: "near", label: "Near Me", icon: <MapPin className="w-4 h-4" /> },
    { id: "trending", label: "Trending", icon: "T" },
    { id: "urgent", label: "Urgent", icon: "!" },
    { id: "latest", label: "Latest", icon: "L" },
  ]

  useEffect(() => {
    if (typeof window === "undefined") return

    try {
      const raw = window.localStorage.getItem(UPVOTED_STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      setUpvotedIssues(Array.isArray(parsed) ? parsed : [])
    } catch {
      setUpvotedIssues([])
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return

    setActorId(getCommunityActorId(user?.email))
  }, [user?.email])

  useEffect(() => {
    if (!actorId) return

    const serverLikedTicketIds = issues
      .filter((issue) => Array.isArray(issue.likedBy) && issue.likedBy.includes(actorId.toLowerCase()))
      .map((issue) => issue.ticketId)

    if (serverLikedTicketIds.length === 0) return

    setUpvotedIssues((current) => {
      const next = Array.from(new Set([...current, ...serverLikedTicketIds]))
      if (typeof window !== "undefined") {
        window.localStorage.setItem(UPVOTED_STORAGE_KEY, JSON.stringify(next))
      }
      return next
    })
  }, [actorId, issues])

  useEffect(() => {
    let active = true

    const loadIssues = async () => {
      try {
        setIsLoading(true)
        setError(null)

        const response = await fetch("/api/reports", { cache: "no-store" })
        const data = await response.json()

        if (!response.ok || data?.success === false) {
          throw new Error(data?.error || "Failed to load community issues.")
        }

        if (active) {
          setIssues(mergeAndStoreReports(Array.isArray(data.reports) ? data.reports : []))
        }
      } catch (err) {
        if (active) {
          const localReports = getLocalReports()
          setIssues(localReports)
          if (localReports.length === 0) {
            setError(err instanceof Error ? err.message : "Failed to load community issues.")
          }
        }
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    }

    loadIssues()

    return () => {
      active = false
    }
  }, [])

  const statusColors: Record<string, string> = {
    Submitted: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-200",
    Pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200",
    Assigned: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200",
    "In Progress": "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200",
    Resolved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200",
  }

  const filteredIssues = [...issues]
    .filter((issue) => {
      const searchableText = [
        issue.title,
        issue.category,
        issue.city,
        getComplaintArea(issue),
        issue.ticketId,
      ]
        .join(" ")
        .toLowerCase()

      if (searchTerm && !searchableText.includes(searchTerm.toLowerCase())) {
        return false
      }

      if (activeFilter === "urgent") {
        return issue.urgency === "High"
      }

      if (activeFilter === "near" && profile?.city) {
        return issue.city.toLowerCase() === profile.city.toLowerCase()
      }

      return true
    })
    .sort((a, b) => {
      if (activeFilter === "trending") {
        return b.upvotes - a.upvotes
      }

      if (activeFilter === "urgent") {
        const urgencyScore = { High: 3, Medium: 2, Low: 1 }
        return urgencyScore[b.urgency] - urgencyScore[a.urgency]
      }

      return b.createdAt.localeCompare(a.createdAt)
    })

  const handleUpvote = async (ticketId: string) => {
    if (!actorId || pendingUpvoteTicketId) {
      return
    }

    const wasLiked = upvotedIssues.includes(ticketId)
    const nextUpvotedIssues = wasLiked
      ? upvotedIssues.filter((id) => id !== ticketId)
      : [...upvotedIssues, ticketId]
    const previousIssues = issues

    try {
      setError(null)
      setPendingUpvoteTicketId(ticketId)
      setUpvotedIssues(nextUpvotedIssues)
      window.localStorage.setItem(UPVOTED_STORAGE_KEY, JSON.stringify(nextUpvotedIssues))

      setIssues((currentIssues) =>
        currentIssues.map((issue) =>
          issue.ticketId === ticketId
            ? {
                ...issue,
                upvotes: Math.max(0, issue.upvotes + (wasLiked ? -1 : 1)),
              }
            : issue,
        ),
      )

      const response = await fetch(`/api/reports/${encodeURIComponent(ticketId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle-upvote",
          actorId,
          userEmail: user?.email,
        }),
      })
      const data = await response.json()

      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || "Failed to update like.")
      }

      const updatedIssue = data.report as ComplaintRecord
      const liked = Boolean(data.liked)
      upsertLocalReport(updatedIssue)
      setIssues((currentIssues) =>
        currentIssues.map((issue) =>
          issue.ticketId === updatedIssue.ticketId ? updatedIssue : issue,
        ),
      )

      const confirmedUpvotedIssues = liked
        ? Array.from(new Set([...upvotedIssues, ticketId]))
        : upvotedIssues.filter((id) => id !== ticketId)

      setUpvotedIssues(confirmedUpvotedIssues)
      window.localStorage.setItem(UPVOTED_STORAGE_KEY, JSON.stringify(confirmedUpvotedIssues))
      console.info("[community] like toggle saved", { ticketId, liked })
    } catch (err) {
      try {
        const { complaint: localIssue, liked } = toggleLocalReportUpvote(ticketId, actorId)
        const confirmedUpvotedIssues = liked
          ? Array.from(new Set([...upvotedIssues, ticketId]))
          : upvotedIssues.filter((id) => id !== ticketId)

        setIssues((currentIssues) =>
          currentIssues.map((issue) =>
            issue.ticketId === localIssue.ticketId ? localIssue : issue,
          ),
        )
        setUpvotedIssues(confirmedUpvotedIssues)
        window.localStorage.setItem(UPVOTED_STORAGE_KEY, JSON.stringify(confirmedUpvotedIssues))
      } catch {
        setUpvotedIssues(upvotedIssues)
        setIssues(previousIssues)
        window.localStorage.setItem(UPVOTED_STORAGE_KEY, JSON.stringify(upvotedIssues))
        setError(err instanceof Error ? err.message : "Failed to update like.")
      }
    } finally {
      setPendingUpvoteTicketId(null)
    }
  }

  return (
    <div className="min-h-[calc(100vh-8rem)] bg-gradient-to-br from-background to-secondary py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Community Issues</h1>
          <p className="text-lg text-muted-foreground">
            See complaints submitted by citizens and track what is happening around your area.
          </p>
        </div>

        <div className="mb-8 relative">
          <Search className="absolute left-4 top-4 w-5 h-5 text-muted-foreground" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by category, city, address, or ticket ID..."
            className="w-full pl-12 pr-4 py-3 rounded-lg bg-card border border-border focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div className="flex gap-2 mb-8 overflow-x-auto pb-2">
          {filters.map((filter) => {
            return (
              <button
                key={filter.id}
                onClick={() => setActiveFilter(filter.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full font-semibold whitespace-nowrap transition-all ${
                  activeFilter === filter.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border border-border text-foreground hover:border-primary"
                }`}
              >
                {filter.icon}
                {filter.label}
              </button>
            )
          })}
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading community complaints...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredIssues.map((issue) => (
              <Link
                key={issue.ticketId}
                href={`/community/${encodeURIComponent(issue.ticketId)}`}
                className="bg-card rounded-xl overflow-hidden border border-border hover:border-primary/50 transition-all duration-300 hover:shadow-lg cursor-pointer group"
              >
                <div className="relative h-48 overflow-hidden bg-muted">
                  <img
                    src={issue.photoUrl || "/placeholder.svg"}
                    alt={issue.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <span
                    className={`absolute top-3 right-3 px-3 py-1 rounded-full text-xs font-semibold ${
                      statusColors[issue.status] || statusColors.Submitted
                    }`}
                  >
                    {issue.status}
                  </span>
                </div>

                <div className="p-6">
                  <div className="mb-4">
                    <h3 className="font-semibold text-lg mb-2 line-clamp-2">{issue.title}</h3>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-1 rounded text-xs font-medium bg-secondary text-secondary-foreground">
                        {issue.category}
                      </span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {getComplaintLocationLabel(issue)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-border">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault()
                        void handleUpvote(issue.ticketId)
                      }}
                      disabled={pendingUpvoteTicketId === issue.ticketId}
                      className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                        upvotedIssues.includes(issue.ticketId)
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-secondary"
                      }`}
                    >
                      <ThumbsUp className="w-4 h-4" />
                      <span>{issue.upvotes}</span>
                    </button>

                    <div className="flex items-center gap-1 text-muted-foreground">
                      <MessageCircle className="w-4 h-4" />
                      <span className="text-sm font-medium">{issue.commentsCount}</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {!isLoading && filteredIssues.length === 0 && (
          <div className="text-center py-12">
            <p className="text-lg text-muted-foreground mb-4">
              {issues.length === 0
                ? "No complaints have been submitted yet. New reports will appear here automatically."
                : "No issues found matching your search"}
            </p>
            <button
              onClick={() => setSearchTerm("")}
              className="px-6 py-2 rounded-lg bg-primary text-primary-foreground font-semibold hover:opacity-90"
            >
              Clear Filters
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
