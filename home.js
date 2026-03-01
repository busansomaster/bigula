import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

/* ===============================
   CONFIGURATION
================================= */

const SUPABASE_URL = "https://uyuofjiiptnbbcuntbfi.supabase.co"
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5dW9mamlpcHRuYmJjdW50YmZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzMzQ3MjcsImV4cCI6MjA4NzkxMDcyN30.-FBKM7NKTSm20qzkExueYhqrE6oaK6a6de1qCsl2nuQ"

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

/* ===============================
   AUTH CHECK
================================= */

const { data: { user }, error: authError } = await supabase.auth.getUser()

if (authError || !user) {
  window.location.href = "/login.html"
  throw new Error("User not authenticated")
}

const currentUser = {
  id: user.id
}

const feed = document.getElementById("feed")

/* ===============================
   LOAD FEED
================================= */

async function loadFeed() {

  const { data: videos, error } = await supabase
    .from("videos")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) {
    console.error("Feed error:", error.message)
    return
  }

  feed.innerHTML = ""

  for (const video of videos) {
    const card = await createVideoCard(video)
    feed.appendChild(card)
  }
}

await loadFeed()

/* ===============================
   CREATE VIDEO CARD
================================= */

async function createVideoCard(video) {

  const card = document.createElement("div")
  card.className = "video-card"
  card.dataset.id = video.id
  card.dataset.uploader = video.creator_id

  const likeCount = await getLikeCount(video.id)
  const commentCount = await getCommentCount(video.id)

  card.innerHTML = `
    <video src="${video.video_url}" controls></video>

    <div class="actions">
      <button class="like-btn">
        ❤️ <span class="like-count">${likeCount}</span>
      </button>

      <button class="comment-toggle">
        💬 <span class="comment-count">${commentCount}</span>
      </button>
    </div>

    <div class="comments-box hidden"></div>
  `

  attachLikeLogic(card, video)
  attachCommentLogic(card, video)

  return card
}

/* ===============================
   LIKE SYSTEM
================================= */

function attachLikeLogic(card, video) {

  const likeBtn = card.querySelector(".like-btn")
  const likeCountEl = card.querySelector(".like-count")

  likeBtn.onclick = async () => {

    const { data: existing } = await supabase
      .from("likes")
      .select("id")
      .eq("video_id", video.id)
      .eq("user_id", currentUser.id)

    if (existing && existing.length > 0) {
      await supabase
        .from("likes")
        .delete()
        .eq("video_id", video.id)
        .eq("user_id", currentUser.id)
    } else {
      await supabase
        .from("likes")
        .insert({
          video_id: video.id,
          user_id: currentUser.id,
          created_at: new Date()
        })
    }

    const newCount = await getLikeCount(video.id)
    likeCountEl.textContent = newCount
  }
}

async function getLikeCount(videoId) {

  const { count } = await supabase
    .from("likes")
    .select("*", { count: "exact", head: true })
    .eq("video_id", videoId)

  return count || 0
}

/* ===============================
   COMMENT SYSTEM
================================= */

function attachCommentLogic(card, video) {

  const toggleBtn = card.querySelector(".comment-toggle")
  const box = card.querySelector(".comments-box")

  toggleBtn.onclick = async () => {

    box.classList.toggle("hidden")

    if (!box.dataset.loaded) {
      await loadComments(video, box)
      box.dataset.loaded = "true"
    }
  }
}

async function loadComments(video, box) {

  const { data: comments } = await supabase
    .from("comments")
    .select("*, users(username)")
    .eq("video_id", video.id)
    .order("created_at", { ascending: true })

  box.innerHTML = `
    <div class="comments-list"></div>
    <input class="comment-input" placeholder="Write a comment...">
    <button class="send-comment">Post</button>
  `

  const list = box.querySelector(".comments-list")

  comments?.forEach(c => {
    list.appendChild(createCommentElement(c, video))
  })

  box.querySelector(".send-comment").onclick = async () => {

    const input = box.querySelector(".comment-input")
    const text = input.value.trim()

    if (!text) return

    await supabase.from("comments").insert({
      video_id: video.id,
      user_id: currentUser.id,
      text: text,
      created_at: new Date()
    })

    input.value = ""
  }
}

async function getCommentCount(videoId) {

  const { count } = await supabase
    .from("comments")
    .select("*", { count: "exact", head: true })
    .eq("video_id", videoId)

  return count || 0
}

/* ===============================
   COMMENT ELEMENT
================================= */

function createCommentElement(comment, video) {

  const div = document.createElement("div")
  div.className = "comment"

  div.innerHTML = `
    <span><b>${comment.users?.username || "User"}</b>: ${comment.text}</span>
    <div class="comment-actions"></div>
  `

  const actions = div.querySelector(".comment-actions")

  // Video owner can delete
  if (video.creator_id === currentUser.id) {

    const delBtn = document.createElement("button")
    delBtn.textContent = "Delete"

    delBtn.onclick = async () => {

      await supabase
        .from("comments")
        .delete()
        .eq("id", comment.id)

      div.remove()
    }

    actions.appendChild(delBtn)
  }

  // Anyone can report
  const reportBtn = document.createElement("button")
  reportBtn.textContent = "Report"

  reportBtn.onclick = async () => {

    await supabase.from("reports").insert({
      comment_id: comment.id,
      reported_by: currentUser.id,
      reason: "User Report",
      created_at: new Date()
    })

    alert("Comment reported")
  }

  actions.appendChild(reportBtn)

  return div
}

/* ===============================
   REALTIME: LIVE COMMENTS
================================= */

supabase
  .channel("live-comments")
  .on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "comments" },
    async (payload) => {

      const videoId = payload.new.video_id
      const card = document.querySelector(`[data-id="${videoId}"]`)
      if (!card) return

      const list = card.querySelector(".comments-list")
      if (!list) return

      // fetch username for new comment
      const { data } = await supabase
        .from("users")
        .select("username")
        .eq("id", payload.new.user_id)
        .single()

      payload.new.users = data

      list.appendChild(
        createCommentElement(payload.new, {
          id: videoId,
          creator_id: card.dataset.uploader
        })
      )
    }
  )
  .subscribe()

/* ===============================
   REALTIME: LIVE LIKES
================================= */

supabase
  .channel("live-likes")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "likes" },
    async (payload) => {

      const videoId = payload.new?.video_id || payload.old?.video_id
      if (!videoId) return

      const card = document.querySelector(`[data-id="${videoId}"]`)
      if (!card) return

      const likeCountEl = card.querySelector(".like-count")
      likeCountEl.textContent = await getLikeCount(videoId)
    }
  )
  .subscribe()
