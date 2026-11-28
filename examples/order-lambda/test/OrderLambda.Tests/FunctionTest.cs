using System.Text;
using Amazon.Lambda.KafkaEvents;
using Amazon.Lambda.Serialization.SystemTextJson;
using Amazon.Lambda.TestUtilities;
using Xunit;

namespace OrderLambda.Tests;

public class FunctionTest
{
    private static readonly DefaultLambdaJsonSerializer Serializer = new();

    /// <summary>
    /// `events/msk-event.json` is exactly what KUI sends in "AWS MSK event" mode (a Rust test in
    /// crates/kui_actions checks that), so this proves AWS's own event type reads KUI's payload.
    /// </summary>
    [Fact]
    public void ReadsTheEventKuiSends()
    {
        using var file = File.OpenRead(Path.Combine("events", "msk-event.json"));
        var kafkaEvent = Serializer.Deserialize<KafkaEvent>(file);

        var record = Assert.Single(kafkaEvent.Records["demo.orders-0"]);
        Assert.Equal("demo.orders", record.Topic);
        Assert.Equal(3, record.Offset);
        Assert.Equal("order-3", Encoding.UTF8.GetString(Convert.FromBase64String(record.Key)));
        Assert.Equal("abc", Encoding.UTF8.GetString((byte[])(Array)record.Headers[0]["traceId"]));

        var processed = new Function().HandleMsk(kafkaEvent, new TestLambdaContext());
        var order = Assert.Single(processed);
        Assert.Equal("order-3", order.OrderId);
        Assert.Equal("charge", order.Decision);
        Assert.Equal("demo.orders-0@3", order.Source);
    }

    [Fact]
    public void ReadsARawOrder()
    {
        using var file = File.OpenRead(Path.Combine("events", "order.json"));
        var order = Serializer.Deserialize<Order>(file);
        Assert.Equal("ship", Function.Decide(order with { Status = "PAID" }, null).Decision);
    }

    [Fact]
    public void RefusesOrdersOverTheLimit()
    {
        var order = new Order("order-9", "cust-2", 499.99m, "NEW");
        var error = Assert.Throws<InvalidOperationException>(() => Function.Decide(order, null));
        Assert.Contains("review limit", error.Message);
    }
}
