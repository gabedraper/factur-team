const setupView = document.getElementById("setupView");
const loginView = document.getElementById("loginView");
const mainView = document.getElementById("mainView");
const logoutBtn = document.getElementById("logoutBtn");
const openSettingsBtn = document.getElementById("openSettingsBtn");

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");

const tabs = document.querySelectorAll(".tab");
const coursesPanel = document.getElementById("coursesPanel");
const bugPanel = document.getElementById("bugPanel");
const coursesList = document.getElementById("coursesList");

const descriptionInput = document.getElementById("description");
const captureBtn = document.getElementById("captureBtn");
const screenshotPreview = document.getElementById("screenshotPreview");
const screenshotImg = document.getElementById("screenshotImg");
const removeScreenshotBtn = document.getElementById("removeScreenshotBtn");
const submitBugBtn = document.getElementById("submitBugBtn");
const bugError = document.getElementById("bugError");
const bugSuccess = document.getElementById("bugSuccess");

let screenshot = null;

function show(view) {
  [setupView, loginView, mainView].forEach((el) => el.classList.add("hidden"));
  view.classList.remove("hidden");
  logoutBtn.classList.toggle("hidden", view !== mainView);
}

async function apiFetch(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

async function init() {
  const baseUrl = await getBaseUrl();
  if (!baseUrl) {
    show(setupView);
    return;
  }

  const session = await getSession();
  if (!session) {
    show(loginView);
    return;
  }

  show(mainView);
  await loadCourses(baseUrl, session);
}

openSettingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

loginBtn.addEventListener("click", async () => {
  loginError.textContent = "";
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) {
    loginError.textContent = "Enter your email and password.";
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "Logging in...";
  try {
    const baseUrl = await getBaseUrl();
    const { ok, data } = await apiFetch(baseUrl, "/api/extension/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    if (!ok) {
      loginError.textContent = data.error || "Login failed.";
      return;
    }

    await setSession({
      accessToken: data.access_token,
      user: data.user,
    });
    passwordInput.value = "";
    show(mainView);
    await loadCourses(baseUrl, { accessToken: data.access_token });
  } catch (err) {
    loginError.textContent = "Could not reach the LMS. Check the URL in Settings.";
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Log in";
  }
});

logoutBtn.addEventListener("click", async () => {
  await clearSession();
  show(loginView);
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const isCourses = tab.dataset.tab === "courses";
    coursesPanel.classList.toggle("hidden", !isCourses);
    bugPanel.classList.toggle("hidden", isCourses);
  });
});

async function loadCourses(baseUrl, session) {
  coursesList.innerHTML = `<p class="empty">Loading...</p>`;

  let ok, status, data;
  try {
    ({ ok, status, data } = await apiFetch(baseUrl, "/api/extension/me", {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    }));
  } catch (err) {
    coursesList.innerHTML = `<p class="empty">Could not reach the LMS. Check the URL in Settings.</p>`;
    return;
  }

  if (status === 401) {
    await clearSession();
    show(loginView);
    loginError.textContent = "Your session expired. Please log in again.";
    return;
  }

  if (!ok) {
    coursesList.innerHTML = `<p class="empty">${data.error || "Could not load courses."}</p>`;
    return;
  }

  if (!data.courses || data.courses.length === 0) {
    coursesList.innerHTML = `<p class="empty">You're not enrolled in any courses yet.</p>`;
    return;
  }

  coursesList.innerHTML = "";
  data.courses
    .slice()
    .sort((a, b) => Number(a.completed) - Number(b.completed))
    .forEach((course) => {
      const row = document.createElement("div");
      row.className = "course-row";
      row.innerHTML = `
        <div class="course-title">${escapeHtml(course.title)}</div>
        <div class="progress-track">
          <div class="progress-fill" style="width: ${course.progress}%"></div>
        </div>
        <div class="progress-label">${course.completed ? "Completed" : `${course.progress}% complete`}</div>
      `;
      row.addEventListener("click", () => {
        chrome.tabs.create({ url: `${baseUrl}/learner/courses/${course.id}` });
      });
      row.style.cursor = "pointer";
      coursesList.appendChild(row);
    });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

captureBtn.addEventListener("click", async () => {
  bugError.textContent = "";
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
    screenshot = { dataUrl, filename: `screenshot-${Date.now()}.png` };
    screenshotImg.src = dataUrl;
    screenshotPreview.classList.remove("hidden");
  } catch (err) {
    bugError.textContent = "Could not capture screenshot on this page.";
  }
});

removeScreenshotBtn.addEventListener("click", () => {
  screenshot = null;
  screenshotPreview.classList.add("hidden");
  screenshotImg.src = "";
});

submitBugBtn.addEventListener("click", async () => {
  bugError.textContent = "";
  bugSuccess.textContent = "";

  const description = descriptionInput.value.trim();
  if (!description) {
    bugError.textContent = "Describe the bug before sending.";
    return;
  }

  submitBugBtn.disabled = true;
  submitBugBtn.textContent = "Sending...";
  try {
    const baseUrl = await getBaseUrl();
    const session = await getSession();
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const { ok, status, data } = await apiFetch(baseUrl, "/api/extension/bug-report", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({
        description,
        pageUrl: activeTab?.url || "",
        screenshot,
      }),
    });

    if (status === 401) {
      await clearSession();
      show(loginView);
      loginError.textContent = "Your session expired. Please log in again.";
      return;
    }

    if (!ok) {
      bugError.textContent = data.error || "Could not send the report.";
      return;
    }

    bugSuccess.textContent = "Thanks! Your report has been sent.";
    descriptionInput.value = "";
    screenshot = null;
    screenshotPreview.classList.add("hidden");
  } catch (err) {
    bugError.textContent = "Could not reach the LMS. Check the URL in Settings.";
  } finally {
    submitBugBtn.disabled = false;
    submitBugBtn.textContent = "Send Report";
  }
});

init();
