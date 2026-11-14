#include <obs-module.h>
#include <obs-frontend-api.h>

#include <QJsonDocument>
#include <QJsonObject>
#include <QLabel>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPushButton>
#include <QTimer>
#include <QUrl>
#include <QVBoxLayout>
#include <QWidget>

#include <algorithm>

OBS_DECLARE_MODULE()
OBS_MODULE_USE_DEFAULT_LOCALE("streamify-obs", "en-US")

namespace {
constexpr const char *kDockId = "streamify-native-dock";
constexpr const char *kCoreBaseUrl = "http://127.0.0.1:47821";

class StreamifyDock final : public QWidget {
public:
    explicit StreamifyDock(QWidget *parent = nullptr) : QWidget(parent)
    {
        setObjectName(QStringLiteral("StreamifyDock"));
        setMinimumWidth(280);

        auto *layout = new QVBoxLayout(this);
        auto *brand = new QLabel(QStringLiteral("STREAMIFY"), this);
        QFont brandFont = brand->font();
        brandFont.setBold(true);
        brandFont.setPointSize(16);
        brand->setFont(brandFont);

        coreLabel = new QLabel(QStringLiteral("Core: checking…"), this);
        obsLabel = new QLabel(QStringLiteral("OBS connection: checking…"), this);
        streamLabel = new QLabel(QStringLiteral("Stream: unknown"), this);
        diagnosticsLabel = new QLabel(QStringLiteral("Diagnostics: waiting for data"), this);
        diagnosticsLabel->setWordWrap(true);
        detailsLabel = new QLabel(
            QStringLiteral("Streamify reads OBS telemetry only. It will not start or stop your broadcast."),
            this);
        detailsLabel->setWordWrap(true);

        auto *refreshButton = new QPushButton(QStringLiteral("Refresh now"), this);
        layout->addWidget(brand);
        layout->addWidget(coreLabel);
        layout->addWidget(obsLabel);
        layout->addWidget(streamLabel);
        layout->addWidget(diagnosticsLabel);
        layout->addWidget(detailsLabel);
        layout->addStretch(1);
        layout->addWidget(refreshButton);

        network = new QNetworkAccessManager(this);
        timer = new QTimer(this);
        timer->setInterval(5000);

        connect(refreshButton, &QPushButton::clicked, this, [this] { refresh(); });
        connect(timer, &QTimer::timeout, this, [this] { refresh(); });
        timer->start();
        refresh();
    }

private:
    QLabel *coreLabel = nullptr;
    QLabel *obsLabel = nullptr;
    QLabel *streamLabel = nullptr;
    QLabel *diagnosticsLabel = nullptr;
    QLabel *detailsLabel = nullptr;
    QNetworkAccessManager *network = nullptr;
    QTimer *timer = nullptr;
    bool requestInFlight = false;

    void refresh()
    {
        if (requestInFlight)
            return;

        requestInFlight = true;
        QNetworkRequest request(QUrl(QStringLiteral(kCoreBaseUrl) + QStringLiteral("/health")));
        request.setTransferTimeout(3000);
        auto *reply = network->get(request);

        connect(reply, &QNetworkReply::finished, this, [this, reply] {
            const bool ok = reply->error() == QNetworkReply::NoError;
            const auto payload = QJsonDocument::fromJson(reply->readAll()).object();
            reply->deleteLater();

            if (!ok) {
                coreLabel->setText(QStringLiteral("Core: not reachable"));
                obsLabel->setText(QStringLiteral("OBS connection: unavailable"));
                streamLabel->setText(QStringLiteral("Stream: unknown"));
                diagnosticsLabel->setText(
                    QStringLiteral("Start Streamify Core on this PC, then refresh."));
                requestInFlight = false;
                return;
            }

            coreLabel->setText(QStringLiteral("Core: online · v%1")
                .arg(payload.value(QStringLiteral("version")).toString(QStringLiteral("unknown"))));
            loadObsStatus();
        });
    }

    void loadObsStatus()
    {
        QNetworkRequest request(QUrl(QStringLiteral(kCoreBaseUrl) + QStringLiteral("/api/v1/obs")));
        request.setTransferTimeout(3000);
        auto *reply = network->get(request);

        connect(reply, &QNetworkReply::finished, this, [this, reply] {
            const bool ok = reply->error() == QNetworkReply::NoError;
            const auto payload = QJsonDocument::fromJson(reply->readAll()).object();
            reply->deleteLater();

            if (!ok) {
                obsLabel->setText(QStringLiteral("OBS connection: status unavailable"));
                requestInFlight = false;
                return;
            }

            const bool enabled = payload.value(QStringLiteral("enabled")).toBool();
            const bool connected = payload.value(QStringLiteral("connected")).toBool();
            obsLabel->setText(connected
                ? QStringLiteral("OBS connection: connected")
                : enabled ? QStringLiteral("OBS connection: waiting for OBS")
                          : QStringLiteral("OBS connection: not configured"));

            const QJsonObject stream = payload.value(QStringLiteral("stream")).toObject();
            streamLabel->setText(stream.value(QStringLiteral("active")).toBool()
                ? QStringLiteral("Stream: LIVE")
                : QStringLiteral("Stream: offline"));

            loadDiagnostics();
        });
    }

    void loadDiagnostics()
    {
        QNetworkRequest request(QUrl(QStringLiteral(kCoreBaseUrl) + QStringLiteral("/api/v1/diagnostics")));
        request.setTransferTimeout(3000);
        auto *reply = network->get(request);

        connect(reply, &QNetworkReply::finished, this, [this, reply] {
            const bool ok = reply->error() == QNetworkReply::NoError;
            const auto payload = QJsonDocument::fromJson(reply->readAll()).object();
            reply->deleteLater();

            if (!ok) {
                diagnosticsLabel->setText(QStringLiteral("Diagnostics: unavailable"));
                requestInFlight = false;
                return;
            }

            const QJsonObject result = payload.value(QStringLiteral("result")).toObject();
            const QJsonObject metrics = result.value(QStringLiteral("metrics")).toObject();
            const auto percentText = [&metrics](const QString &key, const QString &name) {
                const QJsonValue value = metrics.value(key).toObject().value(QStringLiteral("value"));
                return value.isDouble()
                    ? QStringLiteral("%1: %2%").arg(name).arg(value.toDouble(), 0, 'f', 2)
                    : QStringLiteral("%1: —").arg(name);
            };

            const QString state = result.value(QStringLiteral("state")).toString(
                payload.value(QStringLiteral("state")).toString(QStringLiteral("unknown")));
            diagnosticsLabel->setText(
                QStringLiteral("Diagnostics: %1\n%2 · %3 · %4")
                    .arg(state,
                         percentText(QStringLiteral("renderingLagPercent"), QStringLiteral("Rendering")),
                         percentText(QStringLiteral("encodingLagPercent"), QStringLiteral("Encoding")),
                         percentText(QStringLiteral("networkDroppedFramesPercent"), QStringLiteral("Network drops"))));
            requestInFlight = false;
        });
    }
};
} // namespace

bool obs_module_load(void)
{
    auto *dock = new StreamifyDock(
        static_cast<QWidget *>(obs_frontend_get_main_window()));

    if (!obs_frontend_add_dock_by_id(kDockId, "Streamify", dock)) {
        delete dock;
        blog(LOG_WARNING, "[Streamify] Could not register OBS dock (duplicate dock id).");
        return false;
    }

    blog(LOG_INFO, "[Streamify] OBS dock loaded. Open it from View > Docks > Streamify.");
    return true;
}

void obs_module_unload(void)
{
    obs_frontend_remove_dock(kDockId);
}

MODULE_EXPORT const char *obs_module_description(void)
{
    return "Native Streamify dock for OBS Studio.";
}
